/**
 * E2E tenant override (S3-08).
 *
 * Verifica el header `X-Tenant-Override`:
 *   - admin_segurasist + override → 200 con datos del tenant override.
 *   - admin_segurasist sin override → 200 con todos los tenants (path bypass).
 *   - admin_mac + override → 403.
 *   - admin_segurasist + tenant-falso (UUID válido pero inexistente) → 404.
 *
 * Pre-requisitos: cognito-local en :9229, prisma seed (tenant `mac`).
 */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

process.env.COGNITO_ENDPOINT = 'http://0.0.0.0:9229';
process.env.DATABASE_URL_BYPASS =
  process.env.DATABASE_URL_BYPASS ??
  'postgresql://segurasist:segurasist@localhost:5432/segurasist?schema=public';

const SUPER_EMAIL = process.env.E2E_SUPERADMIN_EMAIL ?? 'superadmin@segurasist.local';
const SUPER_PASSWORD = process.env.E2E_SUPERADMIN_PASSWORD ?? 'Demo123!';
const ADMIN_MAC_EMAIL = 'admin@mac.local';
const ADMIN_MAC_PASSWORD = 'Admin123!';

interface LoginResponseBody {
  accessToken: string;
  idToken?: string;
  expiresIn: number;
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

async function loginAdmin(server: Server, email: string, password: string): Promise<string> {
  const res = await request(server)
    .post('/v1/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login ${email} → ${res.status} ${JSON.stringify(res.body)}`);
  }
  const body = res.body as LoginResponseBody;
  if (!body.idToken) throw new Error(`login ${email} sin idToken`);
  return body.idToken;
}

describe('Tenant override E2E (S3-08)', () => {
  let app: INestApplication;
  let server: Server;
  let superToken: string | undefined;
  let adminMacToken: string | undefined;
  let macTenantId: string | undefined;
  let bypassEnabled = false;

  beforeAll(async () => {
    bypassEnabled =
      typeof process.env.DATABASE_URL_BYPASS === 'string' && process.env.DATABASE_URL_BYPASS.length > 0;
    if (!bypassEnabled) {
      // eslint-disable-next-line no-console
      console.warn('[tenant-override.e2e] omitido: DATABASE_URL_BYPASS no configurada.');
      return;
    }
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;
    try {
      superToken = await loginAdmin(server, SUPER_EMAIL, SUPER_PASSWORD);
      adminMacToken = await loginAdmin(server, ADMIN_MAC_EMAIL, ADMIN_MAC_PASSWORD);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[tenant-override.e2e] cognito-local no disponible: ${msg}`);
      bypassEnabled = false;
      return;
    }
    const tRes = await request(server).get('/v1/tenants').set('Authorization', `Bearer ${superToken}`);
    const tenants = tRes.body as Array<{ id: string; slug: string }>;
    macTenantId = tenants.find((t) => t.slug === 'mac')?.id;
    if (!macTenantId) {
      // eslint-disable-next-line no-console
      console.warn('[tenant-override.e2e] no encontré tenant mac via /v1/tenants');
      bypassEnabled = false;
    }
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---------------------------------------------------------------------
  // GET /v1/tenants/active — el endpoint que el dropdown del switcher usa.
  // ---------------------------------------------------------------------
  describe('GET /v1/tenants/active', () => {
    it('admin_segurasist → 200 con array {id,name,slug}', async () => {
      if (!bypassEnabled) return;
      const res = await request(server)
        .get('/v1/tenants/active')
        .set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(200);
      const body = res.body as Array<{ id: string; name: string; slug: string }>;
      expect(Array.isArray(body)).toBe(true);
      if (body.length > 0) {
        const first = body[0];
        if (!first) throw new Error('first item undefined');
        expect(first).toHaveProperty('id');
        expect(first).toHaveProperty('name');
        expect(first).toHaveProperty('slug');
      }
    });

    it('admin_mac → 403 (RBAC: sólo admin_segurasist)', async () => {
      if (!bypassEnabled) return;
      const res = await request(server)
        .get('/v1/tenants/active')
        .set('Authorization', `Bearer ${adminMacToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------
  // X-Tenant-Override semántica.
  // ---------------------------------------------------------------------
  describe('X-Tenant-Override header', () => {
    it('admin_segurasist + X-Tenant-Override=<mac> → 200 con datos del override tenant', async () => {
      if (!bypassEnabled || !macTenantId) return;
      const res = await request(server)
        .get('/v1/insureds')
        .set('Authorization', `Bearer ${superToken}`)
        .set('X-Tenant-Override', macTenantId);
      expect(res.status).toBe(200);
    });

    it('admin_segurasist sin X-Tenant-Override → 200 con todos los tenants (path bypass)', async () => {
      if (!bypassEnabled) return;
      const res = await request(server).get('/v1/insureds').set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(200);
    });

    it('admin_mac + X-Tenant-Override=<mac> → 403 (rol no autorizado)', async () => {
      if (!bypassEnabled || !macTenantId) return;
      const res = await request(server)
        .get('/v1/insureds')
        .set('Authorization', `Bearer ${adminMacToken}`)
        .set('X-Tenant-Override', macTenantId);
      expect(res.status).toBe(403);
    });

    it('admin_segurasist + X-Tenant-Override=<UUID-no-existe> → 404', async () => {
      if (!bypassEnabled) return;
      const fakeUuid = '99999999-9999-4999-8999-999999999999';
      const res = await request(server)
        .get('/v1/insureds')
        .set('Authorization', `Bearer ${superToken}`)
        .set('X-Tenant-Override', fakeUuid);
      expect(res.status).toBe(404);
    });

    it('admin_segurasist + X-Tenant-Override=not-a-uuid → 403 (formato inválido, NO 404)', async () => {
      if (!bypassEnabled) return;
      const res = await request(server)
        .get('/v1/insureds')
        .set('Authorization', `Bearer ${superToken}`)
        .set('X-Tenant-Override', 'not-a-uuid');
      expect(res.status).toBe(403);
    });
  });
});
