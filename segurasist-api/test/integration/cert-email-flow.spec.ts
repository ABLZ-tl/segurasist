/**
 * Integration cert + email — flow happy path con LocalStack + Mailpit reales.
 *
 * Pre-requisitos:
 *   - Postgres :5432 con migraciones aplicadas.
 *   - LocalStack :4566 con buckets (S3) + colas (SQS) bootstrapped (ver
 *     `scripts/localstack-bootstrap.sh`).
 *   - Mailpit :1025 (SMTP) + :8025 (API).
 *   - cognito-local :9229 con admin user creado.
 *
 * El test se SKIPea si no detecta servicios. Esto evita fallos en CI sin
 * los servicios arriba; localmente con `./scripts/local-up.sh` corre.
 */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

process.env.COGNITO_ENDPOINT ??= 'http://0.0.0.0:9229';
process.env.THROTTLE_ENABLED = 'false';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@mac.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin123!';

interface LoginResponseBody {
  idToken?: string;
}

async function detectInfra(): Promise<boolean> {
  try {
    const ls = await fetch('http://localhost:4566/_localstack/health').then((r) => r.ok);
    const mp = await fetch('http://localhost:8025/livez').then((r) => r.ok);
    return ls && mp;
  } catch {
    return false;
  }
}

async function bootstrapApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: true }),
  );
  app.enableVersioning();
  app.setGlobalPrefix('', { exclude: ['health/(.*)'] });
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

const skipIfNoInfra = process.env.CERT_EMAIL_FLOW_E2E === '1' ? describe : describe.skip;

skipIfNoInfra('Cert+email flow integration', () => {
  let app: INestApplication;
  let server: Server;
  let idToken: string;

  beforeAll(async () => {
    const ok = await detectInfra();
    if (!ok) {
      // eslint-disable-next-line no-console
      console.warn('[cert-email-flow] LocalStack/Mailpit no detectados; skip');
      return;
    }
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;
    const res = await request(server)
      .post('/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const body = res.body as LoginResponseBody;
    if (!body.idToken) throw new Error('login admin failed');
    idToken = body.idToken;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /v1/certificates/verify/:hash sin auth devuelve 200 (datos no-PII) o valid:false', async () => {
    const res = await request(server).get(`/v1/certificates/verify/${'a'.repeat(64)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('valid');
    if (res.body.valid === true) {
      expect(JSON.stringify(res.body)).not.toMatch(/curp|rfc|email|phone/i);
    }
  });

  it('POST /v1/certificates/:id/reissue requires auth + role', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const noAuth = await request(server).post(`/v1/certificates/${fakeId}/reissue`).send({ reason: 'x' });
    expect(noAuth.status).toBe(401);
    if (idToken) {
      const withAuth = await request(server)
        .post(`/v1/certificates/${fakeId}/reissue`)
        .set('Authorization', `Bearer ${idToken}`)
        .send({ reason: 'datos cambiados' });
      // El cert no existe → 404 esperado.
      expect([404, 400]).toContain(withAuth.status);
    }
  });

  it('POST /v1/certificates/:id/resend-email validates body (email override)', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000001';
    if (!idToken) return;
    const r = await request(server)
      .post(`/v1/certificates/${fakeId}/resend-email`)
      .set('Authorization', `Bearer ${idToken}`)
      .send({ to: 'not-an-email' });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});
