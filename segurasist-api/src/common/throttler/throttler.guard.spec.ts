import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mockHttpContext } from '../../../test/mocks/execution-context.mock';
import { SKIP_THROTTLE_KEY, THROTTLE_KEY } from './throttler.decorators';
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

class FakeStorage implements ThrottlerStorage {
  hits = 0;
  ttlMs = 60_000;
  // Permite simular la "ventana" sin tener Redis.
  async increment(_key: string, ttlMs: number): Promise<{ totalHits: number; timeToExpireMs: number }> {
    this.hits += 1;
    this.ttlMs = ttlMs;
    return { totalHits: this.hits, timeToExpireMs: ttlMs };
  }
}

describe('ThrottlerGuard', () => {
  const defaultConfig: ThrottleConfig = { ttl: 60_000, limit: 3 };
  let reflector: Reflector;
  let storage: FakeStorage;
  let guard: ThrottlerGuard;

  beforeEach(() => {
    reflector = new Reflector();
    storage = new FakeStorage();
    guard = new ThrottlerGuard(reflector, storage, defaultConfig);
  });

  function spyMeta(opts: { skip?: boolean; throttle?: ThrottleConfig | undefined }): void {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === SKIP_THROTTLE_KEY) return opts.skip ?? false;
      if (key === THROTTLE_KEY) return opts.throttle;
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
});
