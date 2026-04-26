/**
 * E2E /v1/users CRUD admin (Sprint 2 cierre de stubs).
 *
 * Pre-requisitos: cognito-local arriba + seed con tenant `mac` y 5 users.
 * Habla contra Postgres real (RLS aplica al PrismaService request-scoped).
 *
 * Operator no tiene acceso → 403 (cubierto en rbac.e2e-spec.ts también, pero
 * lo replicamos aquí para tener el guardrail por endpoint).
 */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

process.env.COGNITO_ENDPOINT = 'http://0.0.0.0:9229';
process.env.DATABASE_URL_BYPASS =
  process.env.DATABASE_URL_BYPASS ??
  'postgresql://segurasist:segurasist@localhost:5432/segurasist?schema=public';

interface LoginResp {
  idToken?: string;
  accessToken: string;
}
interface MeResp {
  id: string;
  tenantId: string | null;
}
interface UsersListResp {
  items: Array<{
    id: string;
    email: string;
    fullName: string;
    role: string;
    status: string;
    tenantId: string | null;
  }>;
  nextCursor: string | null;
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

async function login(server: Server, email: string, password: string): Promise<string> {
  const res = await request(server)
    .post('/v1/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login ${email} falló: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const body = res.body as LoginResp;
  if (!body.idToken) throw new Error(`login ${email} sin idToken`);
  return body.idToken;
}

describe('Users E2E (CRUD admin)', () => {
  let app: INestApplication;
  let server: Server;
  let adminToken: string;
  let operatorToken: string;
  let macTenantId: string;
  // Track creados por el spec para cleanup.
  const createdEmails: string[] = [];

  beforeAll(async () => {
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;
    adminToken = await login(server, 'admin@mac.local', 'Admin123!');
    operatorToken = await login(server, 'operator@mac.local', 'Demo123!');
    const me = await request(server).get('/v1/auth/me').set('Authorization', `Bearer ${adminToken}`);
    macTenantId = (me.body as MeResp).tenantId as string;
    expect(macTenantId).toMatch(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    );
  }, 60_000);

  afterAll(async () => {
    if (createdEmails.length > 0) {
      const pc = new PrismaClient({
        datasources: { db: { url: process.env.DATABASE_URL_BYPASS } },
      });
      try {
        await pc.user.deleteMany({ where: { email: { in: createdEmails } } });
      } finally {
        await pc.$disconnect();
      }
    }
    if (app) await app.close();
  });

  it('GET /v1/users como admin_mac → 200 con items (al menos seedeados)', async () => {
    const res = await request(server).get('/v1/users').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const body = res.body as UsersListResp;
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(4);
    // No debe filtrar cognitoSub.
    expect(body.items[0]).not.toHaveProperty('cognitoSub');
  });

  it('GET /v1/users como operator → 403', async () => {
    const res = await request(server).get('/v1/users').set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /v1/users?role=operator filtra correctamente', async () => {
    const res = await request(server)
      .get('/v1/users?role=operator')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const body = res.body as UsersListResp;
    expect(body.items.length).toBeGreaterThan(0);
    body.items.forEach((u) => expect(u.role).toBe('operator'));
  });

  it('POST /v1/users con body válido → 201 con UserSummary', async () => {
    const email = `e2e-new-${Date.now()}@mac.local`;
    createdEmails.push(email);
    const res = await request(server)
      .post('/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send({ email, fullName: 'E2E Test User', role: 'operator' });
    expect(res.status).toBe(201);
    const body = res.body as { email: string; status: string; tenantId: string };
    expect(body.email).toBe(email);
    expect(body.status).toBe('invited');
    expect(body.tenantId).toBe(macTenantId);
  });

  it('POST /v1/users con email duplicado → 409 USER_EMAIL_EXISTS', async () => {
    const res = await request(server)
      .post('/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send({ email: 'admin@mac.local', fullName: 'Dup Admin', role: 'operator' });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('USER_EMAIL_EXISTS');
  });

  it('POST /v1/users con role admin_segurasist → rechazado por Zod (422)', async () => {
    const res = await request(server)
      .post('/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send({ email: 'super-attempt@mac.local', fullName: 'X', role: 'admin_segurasist' });
    // El enum de Zod no incluye admin_segurasist → Zod ZodError → 422 VALIDATION_ERROR.
    expect(res.status).toBe(422);
  });

  it('PATCH /v1/users/:id cambiar fullName → 200', async () => {
    // Buscar el id del operator seed via list.
    const list = await request(server)
      .get('/v1/users?role=operator')
      .set('Authorization', `Bearer ${adminToken}`);
    const opId = (list.body as UsersListResp).items[0]?.id as string;
    expect(opId).toBeDefined();

    const res = await request(server)
      .patch(`/v1/users/${opId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send({ fullName: 'Operator Renombrado E2E' });
    expect(res.status).toBe(200);
    expect((res.body as { fullName: string }).fullName).toBe('Operator Renombrado E2E');

    // Restore para no contaminar otros tests.
    await request(server)
      .patch(`/v1/users/${opId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send({ fullName: 'Operator MAC (seed)' });
  });

  it('PATCH /v1/users/:id con role=admin_segurasist → 422 (Zod enum)', async () => {
    const list = await request(server)
      .get('/v1/users?role=operator')
      .set('Authorization', `Bearer ${adminToken}`);
    const opId = (list.body as UsersListResp).items[0]?.id as string;
    const res = await request(server)
      .patch(`/v1/users/${opId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send({ role: 'admin_segurasist' });
    expect(res.status).toBe(422);
  });

  it('DELETE /v1/users/:id no-self → 200 status disabled, luego restore via PATCH', async () => {
    // Crear un usuario fresco para no romper los seedeados.
    const email = `e2e-delete-${Date.now()}@mac.local`;
    createdEmails.push(email);
    const created = await request(server)
      .post('/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send({ email, fullName: 'To Delete', role: 'operator' });
    expect(created.status).toBe(201);
    const newId = (created.body as { id: string }).id;

    const res = await request(server)
      .delete(`/v1/users/${newId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('disabled');
  });

  it('DELETE /v1/users/<own-id> → 422 USER_CANNOT_DELETE_SELF', async () => {
    // Resolver el id real del admin caller buscándolo en la lista por email.
    const list = await request(server)
      .get('/v1/users?role=admin_mac')
      .set('Authorization', `Bearer ${adminToken}`);
    const adminRow = (list.body as UsersListResp).items.find((u) => u.email === 'admin@mac.local');
    expect(adminRow).toBeDefined();

    const res = await request(server)
      .delete(`/v1/users/${adminRow?.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe('USER_CANNOT_DELETE_SELF');
  });
});
