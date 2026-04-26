/**
 * E2E superadmin (M2).
 *
 * Verifica el path cross-tenant: login como `admin_segurasist`, request a
 * `/v1/tenants` (endpoint protegido por `@Roles('admin_segurasist')`), y se
 * espera ver al menos 1 tenant.
 *
 * Pre-requisitos:
 *   - cognito-local arriba con `./scripts/cognito-local-bootstrap.sh`
 *   - prisma db seed corrido (5 users en tenant `mac` + 1 superadmin sin tenant)
 *   - migración M2 aplicada (users.tenant_id NULLABLE) y `prisma/rls/policies.sql`
 *     ejecutado (rol `segurasist_admin` con BYPASSRLS).
 *   - `DATABASE_URL_BYPASS` apuntando al rol `segurasist_admin` (en .env).
 *
 * Si `DATABASE_URL_BYPASS` no está seteado, el test se salta — el harness lo
 * indica con un console.warn (igual que cross-tenant.spec.ts).
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
// M2 — superadmin: requiere DATABASE_URL_BYPASS apuntando al rol DB BYPASSRLS.
// En dev local reutilizamos el rol superuser del docker-compose (segurasist).
// En CI/staging/prod debe apuntar al rol `segurasist_admin`.
process.env.DATABASE_URL_BYPASS =
  process.env.DATABASE_URL_BYPASS ??
  'postgresql://segurasist:segurasist@localhost:5432/segurasist?schema=public';

const SUPER_EMAIL = process.env.E2E_SUPERADMIN_EMAIL ?? 'superadmin@segurasist.local';
const SUPER_PASSWORD = process.env.E2E_SUPERADMIN_PASSWORD ?? 'Demo123!';

interface LoginResponseBody {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn: number;
}

interface MeResponseBody {
  id: string;
  email: string;
  role: string;
  tenant: { id: string } | null;
  tenantId: string | null;
  pool: 'admin' | 'insured' | null;
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

describe('Superadmin E2E (M2 — cross-tenant via BYPASSRLS)', () => {
  let app: INestApplication;
  let server: Server;
  let superToken: string | undefined;
  let bypassEnabled = false;

  beforeAll(async () => {
    bypassEnabled =
      typeof process.env.DATABASE_URL_BYPASS === 'string' && process.env.DATABASE_URL_BYPASS.length > 0;
    if (!bypassEnabled) {
      // eslint-disable-next-line no-console
      console.warn(
        '[superadmin.e2e] omitido: DATABASE_URL_BYPASS no configurada. ' +
          'Setearla apuntando al rol DB segurasist_admin (BYPASSRLS) para correr este spec.',
      );
      return;
    }
    // sanity check para no esconder fallas de prisma migrate / seed
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;

    const res = await request(server)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: SUPER_EMAIL, password: SUPER_PASSWORD });
    if (res.status !== 200) {
      throw new Error(`[setup] login superadmin falló → ${res.status} ${JSON.stringify(res.body)}`);
    }
    const body = res.body as LoginResponseBody;
    if (!body.idToken) throw new Error('[setup] superadmin sin idToken');
    superToken = body.idToken;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /v1/auth/me como superadmin → tenant=null, pool=admin', async () => {
    if (!bypassEnabled) {
      expect(true).toBe(true);
      return;
    }
    const res = await request(server).get('/v1/auth/me').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    const body = res.body as MeResponseBody;
    expect(body.role).toBe('admin_segurasist');
    expect(body.tenant).toBeNull();
    expect(body.tenantId).toBeNull();
    expect(body.pool).toBe('admin');
    expect(body.email).toBe(SUPER_EMAIL);
  });

  it('GET /v1/tenants como superadmin → 200 con al menos 1 tenant', async () => {
    if (!bypassEnabled) {
      expect(true).toBe(true);
      return;
    }
    const res = await request(server).get('/v1/tenants').set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    const body = res.body as Array<{ id: string; slug: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // El tenant `mac` lo crea el seed.
    expect(body.some((t) => t.slug === 'mac')).toBe(true);
  });
});
