import type { RedisService } from '@infra/cache/redis.service';
import { buildTenantKey, ThrottlerRedisStorage } from './throttler-redis.storage';

interface FakeMulti {
  incr(key: string): FakeMulti;
  pttl(key: string): FakeMulti;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

function buildFakeRedis(opts: {
  incrSequence: number[];
  pttlSequence: number[];
  pexpire?: jest.Mock;
  failOnce?: boolean;
}): { redis: RedisService; pexpire: jest.Mock } {
  let incrIdx = 0;
  let pttlIdx = 0;
  let nextIncrThrows = !!opts.failOnce;
  const pexpire = opts.pexpire ?? jest.fn().mockResolvedValue(1);

  const multi = (): FakeMulti => {
    let pendingIncr = 0;
    let pendingPttl = 0;
    return {
      incr(_key: string) {
        pendingIncr += 1;
        return this;
      },
      pttl(_key: string) {
        pendingPttl += 1;
        return this;
      },
      async exec() {
        if (nextIncrThrows) {
          nextIncrThrows = false;
          throw new Error('redis down');
        }
        const out: Array<[Error | null, unknown]> = [];
        for (let i = 0; i < pendingIncr; i += 1) {
          const v = opts.incrSequence[incrIdx] ?? 1;
          incrIdx += 1;
          out.push([null, v]);
        }
        for (let i = 0; i < pendingPttl; i += 1) {
          const v = opts.pttlSequence[pttlIdx] ?? -1;
          pttlIdx += 1;
          out.push([null, v]);
        }
        return out;
      },
    };
  };

  const fakeClient = {
    multi: () => multi(),
    pexpire: pexpire,
  };
  const redis = { raw: fakeClient } as unknown as RedisService;
  return { redis, pexpire };
}

describe('ThrottlerRedisStorage', () => {
  it('primer hit fija PEXPIRE y devuelve totalHits=1', async () => {
    const { redis, pexpire } = buildFakeRedis({
      incrSequence: [1],
      pttlSequence: [-1],
    });
    const storage = new ThrottlerRedisStorage(redis);
    const out = await storage.increment('k', 60_000);
    expect(out.totalHits).toBe(1);
    expect(out.timeToExpireMs).toBe(60_000);
    expect(pexpire).toHaveBeenCalledTimes(1);
  });

  it('hits subsecuentes NO resetean PEXPIRE si la key ya tenía TTL', async () => {
    const { redis, pexpire } = buildFakeRedis({
      incrSequence: [2],
      pttlSequence: [42_000],
    });
    const storage = new ThrottlerRedisStorage(redis);
    const out = await storage.increment('k', 60_000);
    expect(out.totalHits).toBe(2);
    expect(out.timeToExpireMs).toBe(42_000);
    expect(pexpire).not.toHaveBeenCalled();
  });

  it('si Redis levanta excepción, fail-open con totalHits=0', async () => {
    const { redis } = buildFakeRedis({
      incrSequence: [],
      pttlSequence: [],
      failOnce: true,
    });
    const storage = new ThrottlerRedisStorage(redis);
    const out = await storage.increment('k', 60_000);
    expect(out.totalHits).toBe(0);
    expect(out.timeToExpireMs).toBe(60_000);
  });

  it('aplica PEXPIRE también cuando PTTL devuelve -1 con totalHits>1 (recuperación)', async () => {
    const { redis, pexpire } = buildFakeRedis({
      incrSequence: [3],
      pttlSequence: [-1],
    });
    const storage = new ThrottlerRedisStorage(redis);
    const out = await storage.increment('k', 60_000);
    expect(out.totalHits).toBe(3);
    expect(out.timeToExpireMs).toBe(60_000);
    expect(pexpire).toHaveBeenCalledTimes(1);
  });

  // S3-10 — helper de tenant key
  describe('buildTenantKey', () => {
    it('compone "<route>|t:<tenantId>" con prefix tenant agnóstico de IP', () => {
      const k = buildTenantKey('tenant-foo', 'POST:/v1/batches');
      expect(k).toBe('POST:/v1/batches|t:tenant-foo');
      // No debe contener prefijos user/IP — separación clara para `redis-cli KEYS t:*`.
      expect(k).not.toContain('u:');
      expect(k).not.toContain('ip:');
    });

    it('genera keys distintas por route (mismo tenant) — buckets independientes', () => {
      const k1 = buildTenantKey('tenant-foo', 'POST:/v1/batches');
      const k2 = buildTenantKey('tenant-foo', 'POST:/v1/insureds/export');
      expect(k1).not.toBe(k2);
    });
  });

  describe('increment + expire para keys tenant-level (S3-10)', () => {
    it('primer hit en una tenant key fija PEXPIRE con el ttl del tenantConfig', async () => {
      const { redis, pexpire } = buildFakeRedis({
        incrSequence: [1],
        pttlSequence: [-1],
      });
      const storage = new ThrottlerRedisStorage(redis);
      const tenantKey = buildTenantKey('tenant-foo', 'POST:/v1/batches');
      const out = await storage.increment(tenantKey, 60_000);
      expect(out.totalHits).toBe(1);
      expect(out.timeToExpireMs).toBe(60_000);
      expect(pexpire).toHaveBeenCalledTimes(1);
      // Validar que la redisKey final lleva el prefijo `throttle:` y la
      // tenant key como subcomponente — sirve de smoke-test del namespacing.
      const calledWith = (pexpire.mock.calls[0]?.[0] ?? '') as string;
      expect(calledWith.startsWith('throttle:')).toBe(true);
      expect(calledWith.includes('t:tenant-foo')).toBe(true);
    });

    it('hits subsecuentes en una tenant key conservan el TTL existente', async () => {
      const { redis, pexpire } = buildFakeRedis({
        incrSequence: [5],
        pttlSequence: [38_000],
      });
      const storage = new ThrottlerRedisStorage(redis);
      const tenantKey = buildTenantKey('tenant-bar', 'POST:/v1/batches');
      const out = await storage.increment(tenantKey, 60_000);
      expect(out.totalHits).toBe(5);
      expect(out.timeToExpireMs).toBe(38_000);
      // PEXPIRE NO se vuelve a llamar — TTL ya en curso.
      expect(pexpire).not.toHaveBeenCalled();
    });
  });
});
