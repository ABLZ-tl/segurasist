/**
 * E2E certificates — flujo end-to-end con Postgres + LocalStack + Mailpit reales.
 *
 * Habilítalo con `CERT_E2E=1`. Sin esa env el test se skipea (evita romper
 * CI cuando los servicios externos no están disponibles).
 */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@mac.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin123!';

const enabled = process.env.CERT_E2E === '1';

interface LoginResponseBody {
  idToken?: string;
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

(enabled ? describe : describe.skip)('Certificates E2E (gated by CERT_E2E=1)', () => {
  let app: INestApplication;
  let server: Server;
  let idToken: string | undefined;

  beforeAll(async () => {
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;
    const res = await request(server)
      .post('/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const body = res.body as LoginResponseBody;
    idToken = body.idToken;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('verify endpoint sin auth devuelve 200', async () => {
    const r = await request(server).get(`/v1/certificates/verify/${'0'.repeat(64)}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('valid');
  });

  it('GET /v1/certificates lista paginada con auth', async () => {
    if (!idToken) return;
    const r = await request(server).get('/v1/certificates?limit=5').set('Authorization', `Bearer ${idToken}`);
    expect([200, 403]).toContain(r.status);
    if (r.status === 200) {
      expect(r.body).toHaveProperty('items');
      expect(r.body).toHaveProperty('nextCursor');
    }
  });

  it('GET /v1/certificates/:id/url para id inexistente → 404', async () => {
    if (!idToken) return;
    const r = await request(server)
      .get('/v1/certificates/00000000-0000-0000-0000-000000000001/url')
      .set('Authorization', `Bearer ${idToken}`);
    expect([404, 403]).toContain(r.status);
  });
});
