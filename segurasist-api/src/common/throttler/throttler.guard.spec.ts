import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mockHttpContext } from '../../../test/mocks/execution-context.mock';
import { SKIP_THROTTLE_KEY, TENANT_THROTTLE_KEY, THROTTLE_KEY } from './throttler.decorators';
import { ThrottlerGuard } from './throttler.guard';
import type { ThrottleConfig, ThrottlerStorage } from './throttler.types';

interface CapturedHeaders {
  headers: Record<string, string>;
}

function buildCtx(req: Record<string, unknown>): {
  ctx: ReturnType<typeof mockHttpContext>;
  reply: CapturedHeaders;
} {
  const reply: CapturedHeaders = { headers: {} };
  const res = {
    header(name: string, value: string) {
      reply.headers[name] = value;
      return this;
    },
  };
  const ctx = mockHttpContext(req, res as unknown as Record<string, unknown>);
  return { ctx, reply };
}

/**
 * Storage en memoria con cuenta INDEPENDIENTE por key.
 *
 * El test original colapsaba todas las keys a un solo contador (`hits++`)
 * porque el guard sólo evaluaba un bucket. Con S3-10 el guard evalúa user-IP
 * Y tenant en paralelo y debe tener contadores separados — si no, un test
 * que dispara 3 requests dejaría hits=6 (3 por bucket) y bloquearía
 * incorrectamente con limit=3 en el primer disparo.
 */
class FakeStorage implements ThrottlerStorage {
  private counters = new Map<string, number>();
  // `lastHits` mantiene compat con tests viejos que leen `storage.hits`.
  hits = 0;
  ttlMs = 60_000;
  async increment(key: string, ttlMs: number): Promise<{ totalHits: number; timeToExpireMs: number }> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    this.hits += 1;
    this.ttlMs = ttlMs;
    return { totalHits: next, timeToExpireMs: ttlMs };
  }
}

describe('ThrottlerGuard', () => {
  const defaultConfig: ThrottleConfig = { ttl: 60_000, limit: 3 };
  // Tenant default permisivo para que los tests legacy NO se vean afectados:
  // límite 1000 nunca se alcanza con un puñado de hits.
  const tenantDefaultConfig: ThrottleConfig = { ttl: 60_000, limit: 1000 };
  let reflector: Reflector;
  let storage: FakeStorage;
  let guard: ThrottlerGuard;

  beforeEach(() => {
    reflector = new Reflector();
    storage = new FakeStorage();
    guard = new ThrottlerGuard(reflector, storage, defaultConfig, tenantDefaultConfig);
  });

  function spyMeta(opts: {
    skip?: boolean;
    throttle?: ThrottleConfig | undefined;
    tenantThrottle?: ThrottleConfig | undefined;
  }): void {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === SKIP_THROTTLE_KEY) return opts.skip ?? false;
      if (key === THROTTLE_KEY) return opts.throttle;
      if (key === TENANT_THROTTLE_KEY) return opts.tenantThrottle;
      return undefined;
    });
  }

  it('permite el paso cuando hits ≤ limit y setea headers de cuota', async () => {
    spyMeta({});
    const { ctx, reply } = buildCtx({ ip: '1.2.3.4', method: 'POST', url: '/v1/x' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(reply.headers['X-RateLimit-Limit']).toBe('3');
    expect(reply.headers['X-RateLimit-Remaining']).toBe('2');
    expect(reply.headers['X-RateLimit-Reset']).toBeDefined();
  });

  it('bloquea con 429 cuando hits > limit y agrega Retry-After', async () => {
    spyMeta({});
    const { ctx } = buildCtx({ ip: '1.2.3.4', method: 'POST', url: '/v1/x' });
    // Disparar 3 hits OK (limit=3), 4to debe bloquear.
    await guard.canActivate(ctx);
    await guard.canActivate(ctx);
    await guard.canActivate(ctx);
    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
  });

  it('header Retry-After presente al bloquear', async () => {
    spyMeta({});
    const { ctx, reply } = buildCtx({ ip: '1.2.3.4', method: 'POST', url: '/v1/x' });
    for (let i = 0; i < 3; i += 1) {
      await guard.canActivate(ctx);
    }
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
    expect(reply.headers['Retry-After']).toBeDefined();
    expect(parseInt(reply.headers['Retry-After'] ?? '0', 10)).toBeGreaterThan(0);
  });

  it('respeta el override @Throttle({ ttl, limit })', async () => {
    spyMeta({ throttle: { ttl: 60_000, limit: 1 } });
    const { ctx } = buildCtx({ ip: '5.6.7.8', method: 'POST', url: '/v1/auth/login' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
  });

  it('@SkipThrottle hace bypass aunque haya hits previos', async () => {
    spyMeta({ skip: true });
    const { ctx } = buildCtx({ ip: '9.9.9.9', method: 'GET', url: '/health/live' });
    // Múltiples llamadas, todas pasan sin tocar storage.
    for (let i = 0; i < 100; i += 1) {
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
    expect(storage.hits).toBe(0);
  });

  it('usa userId+IP como key cuando hay user en el request', async () => {
    spyMeta({});
    const incrementSpy = jest.spyOn(storage, 'increment');
    const user = {
      id: 'user-1',
      cognitoSub: 's',
      email: 'a@b.c',
      role: 'operator',
      scopes: [],
      mfaEnrolled: true,
    };
    const { ctx } = buildCtx({ ip: '1.2.3.4', method: 'POST', url: '/v1/x', user });
    await guard.canActivate(ctx);
    expect(incrementSpy).toHaveBeenCalledTimes(1);
    const key = incrementSpy.mock.calls[0]?.[0] ?? '';
    expect(key).toContain('u:user-1');
    expect(key).toContain('1.2.3.4');
  });

  it('cae a IP cuando no hay user (preauth/public)', async () => {
    spyMeta({});
    const incrementSpy = jest.spyOn(storage, 'increment');
    const { ctx } = buildCtx({ ip: '7.7.7.7', method: 'POST', url: '/v1/auth/login' });
    await guard.canActivate(ctx);
    const key = incrementSpy.mock.calls[0]?.[0] ?? '';
    expect(key).toContain('ip:7.7.7.7');
    expect(key).not.toContain('u:');
  });

  it('IP unknown si fastify no resuelve req.ip ni socket', async () => {
    spyMeta({});
    const incrementSpy = jest.spyOn(storage, 'increment');
    const { ctx } = buildCtx({ method: 'POST', url: '/v1/x' });
    await guard.canActivate(ctx);
    const key = incrementSpy.mock.calls[0]?.[0] ?? '';
    expect(key).toContain('unknown');
  });

  // S3-10 — bucket tenant-level
  describe('tenant-level rate limit (S3-10)', () => {
    it('cuando hay req.tenant computa BOTH user-IP key Y tenant key', async () => {
      spyMeta({});
      const incrementSpy = jest.spyOn(storage, 'increment');
      const tenant = { id: 'tenant-foo' };
      const user = {
        id: 'u1',
        cognitoSub: 's',
        email: 'a@b.c',
        role: 'operator',
        scopes: [],
        mfaEnrolled: true,
      };
      const { ctx } = buildCtx({ ip: '1.2.3.4', method: 'POST', url: '/v1/batches', user, tenant });
      await guard.canActivate(ctx);
      // 2 calls: 1 user-IP + 1 tenant
      expect(incrementSpy).toHaveBeenCalledTimes(2);
      const keys = incrementSpy.mock.calls.map((c) => c[0]);
      // user-IP key incluye `u:` y la IP
      expect(keys.some((k) => k.includes('u:u1') && k.includes('1.2.3.4'))).toBe(true);
      // tenant key incluye `t:` y NO la IP
      expect(keys.some((k) => k.includes('t:tenant-foo') && !k.includes('1.2.3.4'))).toBe(true);
    });

    it('respeta el override @TenantThrottle({ ttl, limit })', async () => {
      // user-IP permisivo (limit alto), tenant estricto (limit=2).
      spyMeta({
        throttle: { ttl: 60_000, limit: 1000 },
        tenantThrottle: { ttl: 60_000, limit: 2 },
      });
      const tenant = { id: 'tenant-foo' };
      const user = {
        id: 'u1',
        cognitoSub: 's',
        email: 'a@b.c',
        role: 'operator',
        scopes: [],
        mfaEnrolled: true,
      };
      const { ctx } = buildCtx({ ip: '1.2.3.4', method: 'POST', url: '/v1/batches', user, tenant });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      // 3er hit excede tenantLimit=2 aunque user-IP siga muy por debajo.
      await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
    });

    it('tenant excede límite → 429 incluso si user-IP NO excede (ataque distribuido)', async () => {
      // Simulamos un tenant donde 3 usuarios distintos disparan en paralelo,
      // cada uno desde su propia IP. Bucket user-IP NUNCA llega a su límite
      // (limit=10 por user). Bucket tenant llega a 3 con limit=2 → 429.
      spyMeta({
        throttle: { ttl: 60_000, limit: 10 },
        tenantThrottle: { ttl: 60_000, limit: 2 },
      });
      const tenant = { id: 'tenant-foo' };
      const mkUser = (id: string) => ({
        id,
        cognitoSub: 's',
        email: 'a@b.c',
        role: 'operator',
        scopes: [],
        mfaEnrolled: true,
      });
      // Hit #1 desde user-A
      const a = buildCtx({ ip: '1.1.1.1', method: 'POST', url: '/v1/batches', user: mkUser('uA'), tenant });
      await expect(guard.canActivate(a.ctx)).resolves.toBe(true);
      // Hit #2 desde user-B
      const b = buildCtx({ ip: '2.2.2.2', method: 'POST', url: '/v1/batches', user: mkUser('uB'), tenant });
      await expect(guard.canActivate(b.ctx)).resolves.toBe(true);
      // Hit #3 desde user-C → tenant bucket 3>2 → bloquea
      const c = buildCtx({ ip: '3.3.3.3', method: 'POST', url: '/v1/batches', user: mkUser('uC'), tenant });
      await expect(guard.canActivate(c.ctx)).rejects.toThrow(HttpException);
      // Header X-RateLimit-Scope = 'tenant' (debug del 429).
      expect(c.reply.headers['X-RateLimit-Scope']).toBe('tenant');
    });

    it('sin tenant context (rutas públicas) → solo evalúa user-IP key', async () => {
      spyMeta({});
      const incrementSpy = jest.spyOn(storage, 'increment');
      const { ctx } = buildCtx({ ip: '7.7.7.7', method: 'POST', url: '/v1/auth/login' });
      await guard.canActivate(ctx);
      // Sin tenant: 1 sola call al storage.
      expect(incrementSpy).toHaveBeenCalledTimes(1);
      const key = incrementSpy.mock.calls[0]?.[0] ?? '';
      expect(key).toContain('ip:7.7.7.7');
      expect(key).not.toContain('t:');
    });
  });
});
