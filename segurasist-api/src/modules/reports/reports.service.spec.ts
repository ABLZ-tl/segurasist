import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';

  function build(): {
    svc: ReportsService;
    prisma: ReturnType<typeof mockPrismaService>;
    redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  } {
    const prisma = mockPrismaService();
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(0),
    };
    const svc = new ReportsService(prisma, redis as never);
    return { svc, prisma, redis };
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
});
