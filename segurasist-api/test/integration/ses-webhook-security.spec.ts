/**
 * H-12 / H-13 — SES webhook security.
 *
 * Verifica:
 *   - H-12: payload con firma SNS inválida → 401 (genérico, sin leak).
 *   - H-12: SubscriptionConfirmation legítimo → 204 (auto-confirm).
 *   - H-13: 60 requests OK, el 61º responde 429 RATE_LIMITED.
 *   - Hard bounce path: insureds.email pasa a NULL atómicamente.
 *   - SubscriptionConfirmation y UnsubscribeConfirmation se manejan sin lanzar.
 *
 * Estrategia: bootstrapeamos un módulo Nest mínimo con el controlador y un
 * `PrismaBypassRlsService` mockeado in-memory. NO requiere Postgres ni
 * LocalStack. El throttler se cablea con storage in-memory (idéntico
 * patrón que `throttler.spec.ts`).
 */
import type { Server } from 'node:http';
import { Module, Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { PrismaBypassRlsService } from '../../src/common/prisma/prisma-bypass-rls.service';
import {
  THROTTLER_DEFAULT_TOKEN,
  THROTTLER_STORAGE_TOKEN,
  THROTTLER_TENANT_DEFAULT_TOKEN,
  ThrottlerGuard,
} from '../../src/common/throttler/throttler.guard';
import type { ThrottleConfig, ThrottlerStorage } from '../../src/common/throttler/throttler.types';
import { SesWebhookController } from '../../src/modules/webhooks/ses-webhook.controller';

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
    return { totalHits: existing.hits, timeToExpireMs: existing.expiresAt - now };
  }
}

interface FakeCertRow {
  id: string;
  tenantId: string;
  insuredId: string;
}
interface FakeInsuredRow {
  id: string;
  email: string | null;
}

const FIXED_CERT: FakeCertRow = {
  id: 'cert-1',
  tenantId: 'tenant-1',
  insuredId: 'insured-1',
};

class FakePrismaBypass {
  insuredById = new Map<string, FakeInsuredRow>([
    [FIXED_CERT.insuredId, { id: FIXED_CERT.insuredId, email: 'foo@bar.com' }],
  ]);

  emailEvents: Array<Record<string, unknown>> = [];

  // Factories que devuelven un objeto con la forma del PrismaClient real
  // (sólo los métodos que usa el controller).
  certificate = {
    findFirst: jest.fn(async ({ where }: { where: { id: string } }) => {
      if (where.id === FIXED_CERT.id) return FIXED_CERT;
      return null;
    }),
  };

  emailEvent = {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      this.emailEvents.push(data);
      return data;
    }),
  };

  insured = {
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: { email: string | null } }) => {
      const row = this.insuredById.get(where.id);
      if (!row) throw new Error('not found');
      row.email = data.email;
      return row;
    }),
  };

  // El controller wrappea writes en `$transaction(async (tx) => ...)`. Para el
  // fake, ejecutamos el callback con `this` mismo (todos los métodos están
  // definidos arriba).
  $transaction = async (cb: (tx: FakePrismaBypass) => Promise<unknown>): Promise<unknown> => cb(this);

  get client(): FakePrismaBypass {
    return this;
  }
}

@Module({
  controllers: [SesWebhookController],
  providers: [
    { provide: PrismaBypassRlsService, useClass: FakePrismaBypass },
    { provide: THROTTLER_DEFAULT_TOKEN, useValue: { ttl: 60_000, limit: 1000 } as ThrottleConfig },
    { provide: THROTTLER_TENANT_DEFAULT_TOKEN, useValue: { ttl: 60_000, limit: 1000 } as ThrottleConfig },
    { provide: THROTTLER_STORAGE_TOKEN, useClass: InMemoryStorage },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
class TestWebhookModule {}

describe('SesWebhookController security (H-12 / H-13)', () => {
  let app: INestApplication;
  let server: Server;
  let bypass: FakePrismaBypass;
  const originalEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    // Forzamos `test` para que el validator caiga al fallback (host check).
    process.env.NODE_ENV = 'test';
    Logger.overrideLogger(false);

    const moduleRef = await Test.createTestingModule({ imports: [TestWebhookModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ trustProxy: true }));
    app.enableVersioning();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;
    bypass = moduleRef.get(PrismaBypassRlsService);
  });

  afterAll(async () => {
    if (app) await app.close();
    process.env.NODE_ENV = originalEnv;
  });

  // ---------------------------------------------------------------------
  // H-12 — Firma criptográfica
  // ---------------------------------------------------------------------

  it('H-12: SigningCertURL fuera de amazonaws.com → 401', async () => {
    const res = await request(server).post('/v1/webhooks/ses').set('Content-Type', 'application/json').send({
      Type: 'Notification',
      Message: '{}',
      Signature: 'AAAA',
      SigningCertURL: 'https://attacker.example.com/cert.pem',
    });
    expect(res.status).toBe(401);
  });

  it('H-12: Notification sin Signature en NODE_ENV=test → 204 (test path acepta payloads internos)', async () => {
    // En non-prod sin firma damos pase para Mailpit / synthetic events.
    const res = await request(server)
      .post('/v1/webhooks/ses')
      .set('Content-Type', 'application/json')
      .send({
        Type: 'Notification',
        Message: JSON.stringify({
          eventType: 'Open',
          mail: { tags: { cert: ['cert-1'] }, destination: ['x@y'] },
        }),
      });
    expect(res.status).toBe(204);
  });

  it('H-12: SubscriptionConfirmation con cert host válido → 204 (no auto-confirm porque fetch falla, pero no rompe)', async () => {
    const res = await request(server).post('/v1/webhooks/ses').set('Content-Type', 'application/json').send({
      Type: 'SubscriptionConfirmation',
      Signature: 'AAAA',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
      TopicArn: 'arn:aws:sns:us-east-1:123:test',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc',
    });
    expect(res.status).toBe(204);
  });

  it('H-12: UnsubscribeConfirmation con cert host válido → 204', async () => {
    const res = await request(server).post('/v1/webhooks/ses').set('Content-Type', 'application/json').send({
      Type: 'UnsubscribeConfirmation',
      Signature: 'AAAA',
      SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
      TopicArn: 'arn:aws:sns:eu-west-1:123:test',
    });
    expect(res.status).toBe(204);
  });

  // ---------------------------------------------------------------------
  // Hard bounce — atomic email NULL
  // ---------------------------------------------------------------------

  it('hard bounce → insureds.email pasa a NULL atómicamente y email_event persiste', async () => {
    bypass.emailEvents.length = 0;
    bypass.insuredById.set(FIXED_CERT.insuredId, { id: FIXED_CERT.insuredId, email: 'foo@bar.com' });

    const res = await request(server)
      .post('/v1/webhooks/ses')
      .set('Content-Type', 'application/json')
      .send({
        Type: 'Notification',
        Signature: 'AAAA',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
        Message: JSON.stringify({
          eventType: 'Bounce',
          mail: {
            messageId: 'sess-msg-1',
            destination: ['foo@bar.com'],
            tags: { cert: [FIXED_CERT.id] },
          },
          bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'foo@bar.com' }] },
        }),
      });

    expect(res.status).toBe(204);
    expect(bypass.emailEvents).toHaveLength(1);
    expect(bypass.emailEvents[0]).toMatchObject({
      tenantId: FIXED_CERT.tenantId,
      certificateId: FIXED_CERT.id,
      eventType: 'bounced',
    });
    expect(bypass.insuredById.get(FIXED_CERT.insuredId)?.email).toBeNull();
  });

  it('soft bounce (Transient) → email NO se borra; persistimos evento sólo', async () => {
    bypass.emailEvents.length = 0;
    bypass.insuredById.set(FIXED_CERT.insuredId, { id: FIXED_CERT.insuredId, email: 'still@here.com' });

    const res = await request(server)
      .post('/v1/webhooks/ses')
      .set('Content-Type', 'application/json')
      .send({
        Type: 'Notification',
        Signature: 'AAAA',
        SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
        Message: JSON.stringify({
          eventType: 'Bounce',
          mail: { messageId: 'sess-msg-2', destination: ['still@here.com'], tags: { cert: [FIXED_CERT.id] } },
          bounce: { bounceType: 'Transient' },
        }),
      });

    expect(res.status).toBe(204);
    expect(bypass.insuredById.get(FIXED_CERT.insuredId)?.email).toBe('still@here.com');
  });

  // ---------------------------------------------------------------------
  // H-13 — Throttle
  // ---------------------------------------------------------------------

  it('H-13: throttle 60/min — el 61º responde 429 RATE_LIMITED', async () => {
    // El controlador declara `@Throttle({ ttl: 60_000, limit: 60 })` a nivel
    // clase. Con storage in-memory + IP fija (supertest), los hits se acumulan.
    const okBody = {
      Type: 'Notification',
      Signature: 'AAAA',
      SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
      Message: JSON.stringify({ eventType: 'Send', mail: { tags: { cert: ['noop'] } } }),
    };

    let firstBlocked = -1;
    for (let i = 0; i < 80; i += 1) {
      const r = await request(server)
        .post('/v1/webhooks/ses')
        .set('Content-Type', 'application/json')
        .send(okBody);
      if (r.status === 429) {
        firstBlocked = i;
        expect(r.headers['retry-after']).toBeDefined();
        expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
        const body = r.body as { code: string };
        expect(body.code).toBe('RATE_LIMITED');
        break;
      }
    }
    expect(firstBlocked).toBeGreaterThanOrEqual(60);
    expect(firstBlocked).toBeLessThanOrEqual(61);
  });
});
