/**
 * S4-01/02/03 — Unit tests para los nuevos métodos de ReportsService.
 *
 *  - getConciliacionReport: agrega counts + sums vs prisma mock; verifica
 *    cifras (cuadrar con BD) y formato.
 *  - getVolumetria90: arma la grilla diaria con días N (default 90); rellena
 *    buckets vacíos con 0.
 *  - getUtilizacion: groupBy → top-N + agregado por paquete.
 *
 * Cache: cubrimos cache miss (compute path) — el cache hit ya está cubierto
 * por `reports.service.spec.ts` para `getActiveInsuredsCount`, mismo wrapper.
 */
import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { mockPrismaService } from '../../../mocks/prisma.mock';
import { ReportsService } from '../../../../src/modules/reports/reports.service';

function build(): {
  svc: ReportsService;
  prisma: ReturnType<typeof mockPrismaService>;
  bypass: DeepMockProxy<PrismaBypassRlsService>;
  redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
} {
  const prisma = mockPrismaService();
  const bypass = mockDeep<PrismaBypassRlsService>();
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(0),
  };
  const svc = new ReportsService(prisma, bypass, redis as never);
  return { svc, prisma, bypass, redis };
}

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('ReportsService — S4-01 conciliación', () => {
  it('agrega activos (inicio/cierre), altas, bajas, certs, claims y coverage_usage', async () => {
    const { svc, prisma } = build();
    // Mocks ordenados: activosInicio, activosCierre, altas, bajas, certs.
    prisma.client.insured.count
      .mockResolvedValueOnce(1000) // activosInicio
      .mockResolvedValueOnce(1080) // activosCierre
      .mockResolvedValueOnce(120) // altas
      .mockResolvedValueOnce(40); // bajas
    prisma.client.certificate.count.mockResolvedValueOnce(95);
    prisma.client.claim.aggregate.mockResolvedValueOnce({
      _count: { _all: 12 },
      _sum: { amountEstimated: 50_000, amountApproved: 30_000 },
    } as never);
    prisma.client.coverageUsage.aggregate.mockResolvedValueOnce({
      _count: { _all: 250 },
      _sum: { amount: 75_500.5 },
    } as never);

    const out = await svc.getConciliacionReport('2026-04-01', '2026-04-30', {
      platformAdmin: false,
      tenantId: TENANT,
      actorId: 'u-1',
    });

    expect(out).toMatchObject({
      from: '2026-04-01',
      to: '2026-04-30',
      tenantId: TENANT,
      activosInicio: 1000,
      activosCierre: 1080,
      altas: 120,
      bajas: 40,
      certificadosEmitidos: 95,
      claimsCount: 12,
      claimsAmountEstimated: 50_000,
      claimsAmountApproved: 30_000,
      coverageUsageCount: 250,
      coverageUsageAmount: 75_500.5,
    });
    expect(out.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('valor null → 0 en sums', async () => {
    const { svc, prisma } = build();
    prisma.client.insured.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prisma.client.certificate.count.mockResolvedValueOnce(0);
    prisma.client.claim.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { amountEstimated: null, amountApproved: null },
    } as never);
    prisma.client.coverageUsage.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { amount: null },
    } as never);

    const out = await svc.getConciliacionReport('2026-04-01', '2026-04-30', {
      platformAdmin: false,
      tenantId: TENANT,
    });
    expect(out.claimsAmountEstimated).toBe(0);
    expect(out.claimsAmountApproved).toBe(0);
    expect(out.coverageUsageAmount).toBe(0);
  });

  it('platformAdmin sin tenantId → tenantId=null + bypass client', async () => {
    const { svc, prisma, bypass } = build();
    bypass.client.insured.count.mockResolvedValue(0 as never);
    bypass.client.certificate.count.mockResolvedValue(0 as never);
    bypass.client.claim.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: {} } as never);
    bypass.client.coverageUsage.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: {} } as never);

    const out = await svc.getConciliacionReport('2026-04-01', '2026-04-30', {
      platformAdmin: true,
      actorId: 'super-1',
    });
    expect(out.tenantId).toBeNull();
    expect(prisma.client.insured.count).not.toHaveBeenCalled();
    expect(bypass.client.insured.count).toHaveBeenCalled();
  });

  it('cachea con TTL 300s y key incluye from/to', async () => {
    const { svc, prisma, redis } = build();
    prisma.client.insured.count.mockResolvedValue(0 as never);
    prisma.client.certificate.count.mockResolvedValue(0 as never);
    prisma.client.claim.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: {} } as never);
    prisma.client.coverageUsage.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: {} } as never);

    await svc.getConciliacionReport('2026-04-01', '2026-04-30', { platformAdmin: false, tenantId: TENANT });
    const [key, _val, ttl] = redis.set.mock.calls[0] as [string, string, number];
    expect(key).toBe(`report:conciliacion:${TENANT}:2026-04-01:2026-04-30`);
    expect(ttl).toBe(300);
  });
});

describe('ReportsService — S4-02 volumetria 90 días', () => {
  it('devuelve N puntos consecutivos (N=days) con keys YYYY-MM-DD', async () => {
    const { svc, prisma } = build();
    prisma.client.$queryRaw.mockResolvedValue([] as never);
    const out = await svc.getVolumetria90(90, { platformAdmin: false, tenantId: TENANT });
    expect(out.points).toHaveLength(90);
    expect(out.days).toBe(90);
    for (const p of out.points) {
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.altas).toBe(0);
      expect(p.bajas).toBe(0);
      expect(p.certificados).toBe(0);
      expect(p.claims).toBe(0);
    }
  });

  it('rellena días sin datos con 0 y mappea los días con datos', async () => {
    const { svc, prisma } = build();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    // Sólo mockeamos altas con un valor en "ayer"; el resto vacío.
    prisma.client.$queryRaw
      .mockResolvedValueOnce([{ day: yesterday, n: 5n }] as never) // altas
      .mockResolvedValueOnce([] as never) // bajas
      .mockResolvedValueOnce([] as never) // certs
      .mockResolvedValueOnce([] as never); // claims

    const out = await svc.getVolumetria90(7, { platformAdmin: false, tenantId: TENANT });
    expect(out.points).toHaveLength(7);
    const yKey = yesterday.toISOString().slice(0, 10);
    const yPoint = out.points.find((p) => p.date === yKey);
    expect(yPoint?.altas).toBe(5);
    expect(yPoint?.bajas).toBe(0);
  });

  it('rango customizable days=30', async () => {
    const { svc, prisma } = build();
    prisma.client.$queryRaw.mockResolvedValue([] as never);
    const out = await svc.getVolumetria90(30, { platformAdmin: false, tenantId: TENANT });
    expect(out.points).toHaveLength(30);
  });
});

describe('ReportsService — S4-03 utilizacion top-N', () => {
  it('orderBy usageAmount DESC, limit topN, agregado byPackage', async () => {
    const { svc, prisma } = build();
    prisma.client.coverageUsage.groupBy.mockResolvedValue([
      { coverageId: 'c1', _count: { _all: 50 }, _sum: { amount: 1000 } },
      { coverageId: 'c2', _count: { _all: 20 }, _sum: { amount: 5000 } },
      { coverageId: 'c3', _count: { _all: 10 }, _sum: { amount: 250 } },
    ] as never);
    prisma.client.coverage.findMany.mockResolvedValue([
      { id: 'c1', name: 'Hospital', type: 'count_based', package: { id: 'p1', name: 'Plan A' } },
      { id: 'c2', name: 'Med', type: 'amount_based', package: { id: 'p1', name: 'Plan A' } },
      { id: 'c3', name: 'Dental', type: 'count_based', package: { id: 'p2', name: 'Plan B' } },
    ] as never);

    const out = await svc.getUtilizacion('2026-04-01', '2026-04-30', 2, {
      platformAdmin: false,
      tenantId: TENANT,
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]?.coverageId).toBe('c2'); // amount=5000 desc
    expect(out.rows[1]?.coverageId).toBe('c1');
    expect(out.byPackage).toHaveLength(2);
    const p1 = out.byPackage.find((x) => x.packageId === 'p1');
    expect(p1?.totalUsageCount).toBe(70);
    expect(p1?.totalUsageAmount).toBe(6000);
    expect(out.byPackage[0]?.packageId).toBe('p1'); // p1 amount=6000 > p2=250
  });

  it('sin datos → rows=[] byPackage=[]', async () => {
    const { svc, prisma } = build();
    prisma.client.coverageUsage.groupBy.mockResolvedValue([] as never);

    const out = await svc.getUtilizacion('2026-04-01', '2026-04-30', 10, {
      platformAdmin: false,
      tenantId: TENANT,
    });
    expect(out.rows).toEqual([]);
    expect(out.byPackage).toEqual([]);
    expect(prisma.client.coverage.findMany).not.toHaveBeenCalled();
  });

  it('coverages que ya no existen (deleted) se filtran', async () => {
    const { svc, prisma } = build();
    prisma.client.coverageUsage.groupBy.mockResolvedValue([
      { coverageId: 'c1', _count: { _all: 5 }, _sum: { amount: 100 } },
      { coverageId: 'c2', _count: { _all: 5 }, _sum: { amount: 100 } },
    ] as never);
    prisma.client.coverage.findMany.mockResolvedValue([
      // Sólo c1 existe.
      { id: 'c1', name: 'Lab', type: 'count_based', package: { id: 'p1', name: 'Plan A' } },
    ] as never);

    const out = await svc.getUtilizacion('2026-04-01', '2026-04-30', 10, {
      platformAdmin: false,
      tenantId: TENANT,
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.coverageId).toBe('c1');
  });

  // --- S1 iter 2 — filtro packageId opcional --------------------------------
  it('packageId opcional: filtra coverages al paquete pedido', async () => {
    const { svc, prisma } = build();
    const PACKAGE = '99999999-9999-9999-9999-999999999999';
    prisma.client.coverageUsage.groupBy.mockResolvedValue([
      { coverageId: 'c1', _count: { _all: 5 }, _sum: { amount: 100 } },
      { coverageId: 'c2', _count: { _all: 5 }, _sum: { amount: 200 } },
    ] as never);
    // Mock simulando el WHERE packageId=X — sólo c2 cae en ese paquete.
    prisma.client.coverage.findMany.mockResolvedValue([
      { id: 'c2', name: 'Med', type: 'amount_based', package: { id: PACKAGE, name: 'Plan Z' } },
    ] as never);

    const out = await svc.getUtilizacion(
      '2026-04-01',
      '2026-04-30',
      10,
      { platformAdmin: false, tenantId: TENANT },
      PACKAGE,
    );
    // Verifica que el findMany recibió el filtro packageId.
    const findArgs = prisma.client.coverage.findMany.mock.calls[0]?.[0];
    expect((findArgs?.where as { packageId?: string }).packageId).toBe(PACKAGE);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.coverageId).toBe('c2');
    expect(out.byPackage).toHaveLength(1);
    expect(out.byPackage[0]?.packageId).toBe(PACKAGE);
  });

  it('packageId cambia el cache key (no colisiona con corrida sin filtro)', async () => {
    const { svc, prisma, redis } = build();
    prisma.client.coverageUsage.groupBy.mockResolvedValue([] as never);
    await svc.getUtilizacion(
      '2026-04-01',
      '2026-04-30',
      10,
      { platformAdmin: false, tenantId: TENANT },
      '99999999-9999-9999-9999-999999999999',
    );
    const setKey = (redis.set.mock.calls[0]?.[0] ?? '') as string;
    expect(setKey).toContain('99999999-9999-9999-9999-999999999999');

    // Misma query sin packageId usa key con sufijo `_all_`.
    redis.set.mockClear();
    redis.get.mockResolvedValue(null);
    await svc.getUtilizacion(
      '2026-04-01',
      '2026-04-30',
      10,
      { platformAdmin: false, tenantId: TENANT },
    );
    const setKey2 = (redis.set.mock.calls[0]?.[0] ?? '') as string;
    expect(setKey2).toContain(':_all_');
    expect(setKey).not.toBe(setKey2);
  });
});
