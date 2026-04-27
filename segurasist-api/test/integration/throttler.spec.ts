/**
 * Integration test del rate limiter aplicado al endpoint
 * `/v1/auth/login`. Disparamos 6 requests rápidos al mismo IP con creds
 * inválidas; el 6º debe responder 429 con Problem Details `RATE_LIMITED`.
 *
 * El test usa una instancia in-memory del storage (sin Redis real) para
 * mantenerlo determinístico y no depender de docker-compose en CI unit.
 * Validamos:
 *   - status 429
 *   - body es `application/problem+json` con `code: 'RATE_LIMITED'`.
 *   - header `Retry-After` presente.
 *   - header `content-type` empieza con 'application/problem+json'.
 *
 * El AuthService NO se llama (cognito-local no está disponible aquí); como
 * el ThrottlerGuard se ejecuta antes de llegar al controller, los 5 primeros
 * caen 401 (cognito stub error / red) y el 6º devuelve 429. Para no acoplar
 * a Cognito mockeamos AuthService para que devuelva 401 controlado.
 */
import type { Server } from 'node:http';
import { Body, Controller, HttpCode, HttpStatus, Module, Post, UnauthorizedException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Public } from '../../src/common/decorators/roles.decorator';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { Throttle } from '../../src/common/throttler/throttler.decorators';
import {
  THROTTLER_DEFAULT_TOKEN,
  THROTTLER_STORAGE_TOKEN,
  THROTTLER_TENANT_DEFAULT_TOKEN,
  ThrottlerGuard,
} from '../../src/common/throttler/throttler.guard';
import type { ThrottleConfig, ThrottlerStorage } from '../../src/common/throttler/throttler.types';

class InMemoryStorage implements ThrottlerStorage {
  private map = new Map<string, { hits: number; expiresAt: number }>();

  async increment(key: string, ttlMs: number): Promise<{ totalHits: number; timeToExpireMs: number }> {
    const now = Date.now();
    const existing = this.map.get(key);
    if (!existing || existing.expiresAt <= now) {
      this.map.set(key, { hits: 1, expiresAt: now + ttlMs });
      return { totalHits: 1, timeToExpireMs: ttlMs };
    }
    existing.hits += 1;
    this.map.set(key, existing);
    return { totalHits: existing.hits, timeToExpireMs: existing.expiresAt - now };
  }
}

@Controller({ path: 'auth', version: '1' })
class FakeAuthController {
  @Public()
  @Throttle({ ttl: 60_000, limit: 5 })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() _dto: unknown): unknown {
    // Simulamos 401 (creds inválidas). El throttler se ejecuta antes de aquí.
    throw new UnauthorizedException('Credenciales inválidas');
  }
}

@Module({
  controllers: [FakeAuthController],
  providers: [
    { provide: THROTTLER_DEFAULT_TOKEN, useValue: { ttl: 60_000, limit: 60 } as ThrottleConfig },
    // S3-10 — el guard ahora requiere también un tenant-default. En este
    // suite no hay req.tenant (FakeAuthController es @Public), así que el
    // bucket tenant es no-op; igual hay que registrar el provider para que
    // Nest pueda resolver el constructor.
    {
      provide: THROTTLER_TENANT_DEFAULT_TOKEN,
      useValue: { ttl: 60_000, limit: 1000 } as ThrottleConfig,
    },
    { provide: THROTTLER_STORAGE_TOKEN, useClass: InMemoryStorage },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
class TestThrottlerModule {}

interface ProblemBody {
  code: string;
  status: number;
  title: string;
  detail?: string;
  type: string;
  traceId: string;
}

describe('ThrottlerGuard integration → /v1/auth/login', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestThrottlerModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ trustProxy: true }));
    app.enableVersioning();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('disparar 6 logins con creds inválidas: el 6º responde 429 RATE_LIMITED', async () => {
    const url = '/v1/auth/login';
    const payload = { email: 'x@y.z', password: 'WrongPass-123!' };

    // 5 primeros: 401
    for (let i = 0; i < 5; i += 1) {
      const r = await request(server).post(url).set('Content-Type', 'application/json').send(payload);
      expect(r.status).toBe(401);
    }

    // 6to: 429 con Problem Details
    const blocked = await request(server).post(url).set('Content-Type', 'application/json').send(payload);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(blocked.headers['retry-after']).toBeDefined();
    const body = blocked.body as ProblemBody;
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.status).toBe(429);
    expect(body.title).toMatch(/cuota/i);
  });
});
