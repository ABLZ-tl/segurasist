/**
 * E2E del flujo de auth admin (Sprint 1 — S1-01).
 *
 * Habla contra cognito-local REAL (puerto 9229). NO mockea el SDK de Cognito.
 * Requiere:
 *   - cognito-local arriba con el pool admin bootstrapeado (./scripts/cognito-local-bootstrap.sh)
 *   - Admin user `admin@mac.local` / `Admin123!` ya creado
 *   - .env apuntando a esos IDs
 *
 * Levanta la AppModule completa con FastifyAdapter en `app.listen(0)` no necesario:
 * supertest se acopla al `app.getHttpServer()` interno (Fastify lo expone como
 * el server HTTP de Node 'detrás'). `init()` es suficiente para Fastify+Nest.
 *
 * IMPORTANTE — divergencia con la spec original:
 *   La spec mencionaba cookies httpOnly `session`/`refresh`. La implementación
 *   actual de `AuthController.login` devuelve los tokens crudos en el body
 *   (`AuthTokens`: accessToken / refreshToken / idToken / expiresIn) y NO setea
 *   cookies. El test sigue lo que la implementación hace hoy. Cuando se
 *   implemente la capa de cookies httpOnly hay que ajustar este archivo.
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

// El issuer que cognito-local pone en los JWTs es `http://0.0.0.0:9229/<pool>`,
// pero `.env` puede tener `http://localhost:9229`. Forzamos consistencia para
// que `JwtAuthGuard` valide los tokens devueltos por `/v1/auth/login`.
process.env.COGNITO_ENDPOINT = 'http://0.0.0.0:9229';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@mac.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin123!';

interface LoginResponseBody {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn: number;
}

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  traceId: string;
  instance?: string;
}

async function bootstrapApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: true }),
  );
  app.enableVersioning();
  app.setGlobalPrefix('', { exclude: ['health/(.*)'] });
  app.useGlobalFilters(new HttpExceptionFilter());
  // Nota: el repo usa `ZodValidationPipe` por endpoint vía `@UsePipes`.
  // No registramos ValidationPipe global (no hay class-validator instalado).

  await app.init();
  // Fastify necesita un `ready()` para que las rutas estén registradas antes de
  // que supertest dispare requests.
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('Auth E2E (admin flow contra cognito-local)', () => {
  let app: INestApplication;
  let server: Server;
  let validIdToken: string | undefined;
  let validRefreshToken: string | undefined;

  beforeAll(async () => {
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('POST /v1/auth/login con credenciales válidas → 200 con AuthTokens', async () => {
    const res = await request(server)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(res.status).toBe(HttpStatus.OK);
    const body = res.body as LoginResponseBody;
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(20);
    expect(typeof body.idToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(body.expiresIn).toBeGreaterThan(0);

    validIdToken = body.idToken;
    validRefreshToken = body.refreshToken;
  }, 30_000);

  it('POST /v1/auth/login con password incorrecto → 401 problem+json', async () => {
    const res = await request(server)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: ADMIN_EMAIL, password: 'WrongPass-123!' });

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    const body = res.body as ProblemBody;
    expect(body.code).toBe('AUTH_INVALID_TOKEN');
    expect(body.status).toBe(401);
    expect(typeof body.traceId).toBe('string');
    // No debe filtrar nada del backing store.
    expect((body.detail ?? '').toLowerCase()).not.toContain('user does not exist');
    expect((body.detail ?? '').toLowerCase()).not.toContain('password');
  }, 30_000);

  it('POST /v1/auth/login con email no existente → 401 sin filtración', async () => {
    const res = await request(server)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'noone-xyz@mac.local', password: 'WhateverPass-123!' });

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    const body = res.body as ProblemBody;
    expect(body.code).toBe('AUTH_INVALID_TOKEN');
    expect(body.status).toBe(401);
    // Mismo mensaje que password incorrecto: no enumera usuarios.
    expect((body.detail ?? '').toLowerCase()).not.toContain('user does not exist');
    expect((body.detail ?? '').toLowerCase()).not.toContain('not found');
  }, 30_000);

  it('GET /v1/auth/me sin Authorization → 401 problem+json', async () => {
    const res = await request(server).get('/v1/auth/me').send();
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    const body = res.body as ProblemBody;
    expect(body.code).toBe('AUTH_INVALID_TOKEN');
    expect(body.status).toBe(401);
  });

  it('GET /v1/auth/me con bearer (idToken) válido → 200 con datos del usuario', async () => {
    expect(validIdToken).toBeDefined();
    const res = await request(server).get('/v1/auth/me').set('Authorization', `Bearer ${validIdToken}`);

    expect(res.status).toBe(HttpStatus.OK);
    const body = res.body as {
      id: string;
      email: string;
      role: string;
      tenant: { id: string } | null;
      tenantId: string | null;
      pool: 'admin' | 'insured' | null;
    };
    expect(body.email).toBe(ADMIN_EMAIL);
    expect(body.role).toBe('admin_mac');
    expect(typeof body.id).toBe('string');
    expect(body.tenantId).toMatch(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    );
    // H3 — admin_mac vive en el pool admin.
    expect(body.pool).toBe('admin');
  }, 30_000);

  it('POST /v1/auth/logout con bearer válido → 204 (revoca refresh, sin body)', async () => {
    expect(validIdToken).toBeDefined();
    const res = await request(server)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${validIdToken}`)
      .set('Content-Type', 'application/json')
      .send({ refreshToken: validRefreshToken });

    expect(res.status).toBe(HttpStatus.NO_CONTENT);
    const empty =
      res.text === '' ||
      res.text === undefined ||
      (typeof res.body === 'object' && Object.keys(res.body as Record<string, unknown>).length === 0);
    expect(empty).toBe(true);
  }, 30_000);
});
