import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';

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

  describe('cache behaviour', () => {
    it('cache miss → invoca compute y persiste', async () => {
      const { svc, prisma, redis } = build();
      prisma.client.insured.count.mockResolvedValueOnce(100).mockResolvedValueOnce(80);
      const out = await svc.getActiveInsuredsCount(tenantId);
      expect(out.value).toBe(100);
      expect(out.trend).toBeCloseTo(25, 1);
      expect(redis.set).toHaveBeenCalledTimes(1);
      const firstCall = redis.set.mock.calls[0] ?? [];
      const [key, raw, ttl] = firstCall as [string, string, number];
      expect(key).toBe(`dashboard:${tenantId}:activeInsureds`);
      expect(JSON.parse(raw)).toMatchObject({ value: 100 });
      expect(ttl).toBe(60);
    });

    it('cache hit → no toca BD', async () => {
      const { svc, prisma, redis } = build();
      redis.get.mockResolvedValueOnce(JSON.stringify({ value: 42, trend: 0 }));
      const out = await svc.getActiveInsuredsCount(tenantId);
      expect(out.value).toBe(42);
      expect(prisma.client.insured.count).not.toHaveBeenCalled();
    });
  });

  describe('KPI formulas', () => {
    it('certificates30d compara ventana actual vs anterior', async () => {
      const { svc, prisma } = build();
      prisma.client.certificate.count
        .mockResolvedValueOnce(50) // current
        .mockResolvedValueOnce(25); // previous
      const out = await svc.getCertificatesIssued30d(tenantId);
      expect(out.value).toBe(50);
      expect(out.trend).toBeCloseTo(100, 1);
    });

    it('claims30d con previo=0 y current>0 ⇒ trend=100', async () => {
      const { svc, prisma } = build();
      prisma.client.claim.count.mockResolvedValueOnce(5).mockResolvedValueOnce(0);
      const out = await svc.getClaims30d(tenantId);
      expect(out.trend).toBe(100);
    });

    it('claims30d con previo=0 y current=0 ⇒ trend=0', async () => {
      const { svc, prisma } = build();
      prisma.client.claim.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      const out = await svc.getClaims30d(tenantId);
      expect(out.value).toBe(0);
      expect(out.trend).toBe(0);
    });

    it('coverageConsumedPct=0 cuando no hay coverages', async () => {
      const { svc, prisma } = build();
      prisma.client.coverage.findMany.mockResolvedValue([] as never);
      const out = await svc.getCoverageConsumedPct(tenantId);
      expect(out.value).toBe(0);
    });

    it('coverageConsumedPct calcula promedio entre coverages count', async () => {
      const { svc, prisma } = build();
      prisma.client.coverage.findMany.mockResolvedValue([
        { id: 'c1', limitCount: 10, limitAmount: null, _count: { usages: 5 } },
        { id: 'c2', limitCount: 4, limitAmount: null, _count: { usages: 2 } },
      ] as never);
      prisma.client.coverageUsage.groupBy.mockResolvedValue([
        { coverageId: 'c1', _count: { _all: 5 }, _sum: { amount: null } },
        { coverageId: 'c2', _count: { _all: 2 }, _sum: { amount: null } },
      ] as never);
      const out = await svc.getCoverageConsumedPct(tenantId);
      // (50% + 50%) / 2 = 50
      expect(out.value).toBe(50);
    });
  });

  describe('volumetry', () => {
    it('devuelve siempre 12 buckets', async () => {
      const { svc, prisma } = build();
      prisma.client.$queryRaw.mockResolvedValue([] as never);
      const out = await svc.getVolumetrySeries(tenantId);
      expect(out).toHaveLength(12);
      expect(out[0]?.altas).toBe(0);
      expect(out[0]?.bajas).toBe(0);
      expect(out[0]?.certs).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // M2 — superadmin cross-tenant.
  // -------------------------------------------------------------------------
  describe('platformAdmin (cross-tenant)', () => {
    it('getActiveInsuredsCount con scope.platformAdmin=true usa bypass client', async () => {
      const { svc, prisma, bypass } = build();
      bypass.client.insured.count.mockResolvedValue(123 as never);
      await svc.getActiveInsuredsCount({ platformAdmin: true, actorId: 'super-1' });
      expect(prisma.client.insured.count).not.toHaveBeenCalled();
      expect(bypass.client.insured.count).toHaveBeenCalledTimes(2);
    });

    it('getActiveInsuredsCount con scope.platformAdmin=true + tenantId aplica filtro', async () => {
      const { svc, bypass } = build();
      bypass.client.insured.count.mockResolvedValue(0 as never);
      const t = '66666666-6666-6666-6666-666666666666';
      await svc.getActiveInsuredsCount({ platformAdmin: true, tenantId: t, actorId: 'super-1' });
      const firstCall = bypass.client.insured.count.mock.calls[0]?.[0];
      expect((firstCall?.where as { tenantId?: string }).tenantId).toBe(t);
    });

    it('cache key usa _global_ cuando platformAdmin=true sin tenantId', async () => {
      const { svc, bypass, redis } = build();
      bypass.client.insured.count.mockResolvedValue(0 as never);
      await svc.getActiveInsuredsCount({ platformAdmin: true, actorId: 'super-1' });
      const setKey = (redis.set.mock.calls[0]?.[0] ?? '') as string;
      expect(setKey).toBe('dashboard:_global_:activeInsureds');
    });

    it('getDashboard acepta ReportsScope (path superadmin) sin lanzar', async () => {
      const { svc, bypass } = build();
      bypass.client.insured.count.mockResolvedValue(0 as never);
      bypass.client.certificate.count.mockResolvedValue(0 as never);
      bypass.client.claim.count.mockResolvedValue(0 as never);
      bypass.client.coverage.findMany.mockResolvedValue([] as never);
      bypass.client.$queryRaw.mockResolvedValue([] as never);
      bypass.client.batch.findMany.mockResolvedValue([] as never);
      bypass.client.certificate.findMany.mockResolvedValue([] as never);
      const out = await svc.getDashboard({ platformAdmin: true, actorId: 'super-1' });
      expect(out.kpis.activeInsureds.value).toBe(0);
      expect(out.volumetry).toHaveLength(12);
    });
  });
});
