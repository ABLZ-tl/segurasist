/**
 * S2-05 integration: cache hit en 2da request <50ms.
 *
 * NO levanta una BD real (el integration project NO tiene testcontainer aún
 * para Sprint 2). En su lugar, mockeamos PrismaService + RedisService a
 * mano y verificamos que la 2da invocación del endpoint vaya por Redis sin
 * tocar PG. La verificación contra PG real vive en e2e/dashboard.e2e-spec.ts
 * cuando esté wired.
 */
import { ReportsService } from '../../src/modules/reports/reports.service';
import { mockPrismaService } from '../mocks/prisma.mock';

describe('Dashboard cache hit performance (integration mock)', () => {
  it('2da request resuelve desde Redis sin tocar Prisma', async () => {
    const prisma = mockPrismaService();
    const cache = new Map<string, string>();
    const redis = {
      get: jest.fn(async (k: string) => cache.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        cache.set(k, v);
      }),
      del: jest.fn(async () => 0),
    };
    prisma.client.insured.count.mockResolvedValueOnce(100).mockResolvedValueOnce(80);
    const svc = new ReportsService(prisma, redis as never);
    const tenantId = '11111111-1111-1111-1111-111111111111';

    const t0 = Date.now();
    const first = await svc.getActiveInsuredsCount(tenantId);
    const t1 = Date.now();
    const second = await svc.getActiveInsuredsCount(tenantId);
    const t2 = Date.now();

    expect(first.value).toBe(100);
    expect(second).toEqual(first);
    // El miss invocó count 2 veces; el hit no invoca Prisma.
    expect(prisma.client.insured.count).toHaveBeenCalledTimes(2);
    // Cache hit debe ser rápido (sin red real, in-memory map ⇒ <50ms holgado).
    expect(t2 - t1).toBeLessThan(50);
    // Que el primero también sea aceptable es side-bonus (mock prisma).
    expect(t1 - t0).toBeLessThan(500);
  });
});
