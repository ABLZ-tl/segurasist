/**
 * E2E del MFA enforcement (Sprint 1 hardening final).
 *
 * Verifica el contrato del JwtAuthGuard cuando `MFA_ENFORCEMENT='strict'`:
 * un admin token sin claim `amr=mfa` (cognito-local NO emite el claim)
 * debe ser rechazado con 403 al hit de un endpoint protegido.
 *
 * Importante: cada spec de e2e levanta su propia AppModule. Forzamos
 * `MFA_ENFORCEMENT='strict'` ANTES del bootstrap y lo restauramos después
 * para no contaminar otros e2e (auth/rbac corren con el default `log`).
 */
import type { Server } from 'node:http';
import { HttpStatus } from '@nestjs/common';
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

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@mac.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin123!';

interface LoginResponseBody {
  idToken?: string;
  accessToken: string;
}

async function bootstrapApp(): Promise<INestApplication> {
  // El ENV_TOKEN factory lee `process.env` al instanciar — basta con setear
  // `process.env.MFA_ENFORCEMENT='strict'` ANTES de Test.createTestingModule.
  // Cada spec compila su propio módulo así que no hay state compartido.
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

describe('MFA enforcement E2E (strict mode)', () => {
  let app: INestApplication;
  let server: Server;
  const originalMfa = process.env.MFA_ENFORCEMENT;

  beforeAll(async () => {
    process.env.MFA_ENFORCEMENT = 'strict';
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (originalMfa === undefined) delete process.env.MFA_ENFORCEMENT;
    else process.env.MFA_ENFORCEMENT = originalMfa;
  });

  it('admin token sin amr=mfa → 403 al hit /v1/auth/me en modo strict', async () => {
    // Login obtiene un idToken legítimo del pool admin (cognito-local).
    // cognito-local NO emite el claim `amr`, así que /v1/auth/me debe
    // ser rechazado con 403 'MFA required for admin role'.
    const loginRes = await request(server)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(loginRes.status).toBe(HttpStatus.OK);
    const idToken = (loginRes.body as LoginResponseBody).idToken;
    expect(typeof idToken).toBe('string');

    const meRes = await request(server).get('/v1/auth/me').set('Authorization', `Bearer ${idToken}`);
    expect(meRes.status).toBe(HttpStatus.FORBIDDEN);
    const body = meRes.body as { detail?: string; code?: string };
    // El detail viene de la ForbiddenException 'MFA required for admin role'.
    expect((body.detail ?? '').toLowerCase()).toContain('mfa');
  }, 30_000);
});
