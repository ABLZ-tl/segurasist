/**
 * E2E superadmin cross-tenant (M2 Bug deferred audit Sprint 1).
 *
 * El superadmin (`admin_segurasist`) debe poder hit endpoints tenant-scoped
 * sin custom:tenant_id en su JWT — el backend usa `PrismaBypassRlsService`
 * (rol DB BYPASSRLS) para leer cross-tenant.
 *
 * Antes de M2, todos estos endpoints retornaban 500 porque el `JwtAuthGuard`
 * marcaba bypassRls=true pero los services seguían usando `PrismaService`
 * request-scoped (NOBYPASSRLS) sin tenant context.
 *
 * Pre-requisitos:
 *   - cognito-local arriba en :9229
 *   - prisma db seed corrido (tenant `mac` con datos demo)
 *   - DATABASE_URL_BYPASS apuntando al rol DB BYPASSRLS (en dev: superuser).
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
  refreshToken?: string;
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

describe('Superadmin cross-tenant E2E (M2)', () => {
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
      console.warn('[superadmin-cross-tenant.e2e] omitido: DATABASE_URL_BYPASS no configurada.');
      return;
    }
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;
    superToken = await loginAdmin(server, SUPER_EMAIL, SUPER_PASSWORD);
    adminMacToken = await loginAdmin(server, ADMIN_MAC_EMAIL, ADMIN_MAC_PASSWORD);

    // Para uno de los tests filtramos por el tenant `mac` real. Lo obtenemos
    // listando /v1/tenants como superadmin.
    const tRes = await request(server).get('/v1/tenants').set('Authorization', `Bearer ${superToken}`);
    const tenants = tRes.body as Array<{ id: string; slug: string }>;
    macTenantId = tenants.find((t) => t.slug === 'mac')?.id;
    if (!macTenantId) throw new Error('[setup] no encontré el tenant mac via /v1/tenants');
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---------------------------------------------------------------------
  // Read endpoints — antes daban 500 al superadmin, ahora deben ser 200.
  // ---------------------------------------------------------------------
  describe('endpoints tenant-scoped — superadmin sin tenantId (cross-tenant)', () => {
    it('GET /v1/insureds → 200', async () => {
      if (!bypassEnabled) return;
      const res = await request(server).get('/v1/insureds').set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(200);
      const body = res.body as { items: unknown[]; nextCursor: string | null };
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('GET /v1/packages → 200', async () => {
      if (!bypassEnabled) return;
      const res = await request(server).get('/v1/packages').set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(200);
      const body = res.body as { items: unknown[] };
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('GET /v1/coverages → 200 (era 500 antes de M2)', async () => {
      if (!bypassEnabled) return;
      const res = await request(server).get('/v1/coverages').set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(200);
    });

    it('GET /v1/reports/dashboard → 200', async () => {
      if (!bypassEnabled) return;
      const res = await request(server)
        .get('/v1/reports/dashboard')
        .set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(200);
      const body = res.body as { kpis: { activeInsureds: { value: number } } };
      expect(typeof body.kpis.activeInsureds.value).toBe('number');
    });
  });

  // ---------------------------------------------------------------------
  // Filtro tenantId opcional — superadmin lo respeta.
  // ---------------------------------------------------------------------
  describe('superadmin con ?tenantId=...', () => {
    it('GET /v1/insureds?tenantId=<mac> → 200 filtrado al tenant mac', async () => {
      if (!bypassEnabled || !macTenantId) return;
      const res = await request(server)
        .get(`/v1/insureds?tenantId=${macTenantId}`)
        .set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(200);
    });

    it('GET /v1/insureds?tenantId=<uuid-inexistente> → 200 con items vacío (no 500)', async () => {
      if (!bypassEnabled) return;
      const fakeUuid = '99999999-9999-4999-8999-999999999999';
      const res = await request(server)
        .get(`/v1/insureds?tenantId=${fakeUuid}`)
        .set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(200);
      const body = res.body as { items: unknown[] };
      expect(body.items).toHaveLength(0);
    });

    it('GET /v1/insureds?tenantId=not-a-uuid → 422 (Zod rechaza el formato)', async () => {
      if (!bypassEnabled) return;
      const res = await request(server)
        .get('/v1/insureds?tenantId=not-a-uuid')
        .set('Authorization', `Bearer ${superToken}`);
      // ZodValidationPipe lanza BadRequest (400) por convención del proyecto;
      // aceptamos 400 o 422 (algunos pipes devuelven 422 unprocessable).
      expect([400, 422]).toContain(res.status);
    });
  });

  // ---------------------------------------------------------------------
  // Smoke regression — admin_mac (tenant-scoped) sigue funcionando.
  // ---------------------------------------------------------------------
  describe('regression — admin_mac sin platformAdmin', () => {
    it('GET /v1/insureds como admin_mac → 200 (path RLS, datos del tenant mac)', async () => {
      if (!bypassEnabled) return;
      const res = await request(server).get('/v1/insureds').set('Authorization', `Bearer ${adminMacToken}`);
      expect(res.status).toBe(200);
    });

    it('GET /v1/packages como admin_mac → 200', async () => {
      if (!bypassEnabled) return;
      const res = await request(server).get('/v1/packages').set('Authorization', `Bearer ${adminMacToken}`);
      expect(res.status).toBe(200);
    });
  });
});
