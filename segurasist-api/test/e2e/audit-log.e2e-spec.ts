/**
 * E2E /v1/audit/log (Sprint 2 cierre de stubs).
 *
 * Pre-requisitos: cognito-local + Postgres real + DATABASE_URL_AUDIT seteado.
 * El AuditWriter ya escribe filas en cualquier mutación (interceptor global).
 * Acá solo leemos.
 */
import type { Server } from 'node:http';
import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { AuditWriterService } from '../../src/modules/audit/audit-writer.service';

process.env.COGNITO_ENDPOINT = 'http://0.0.0.0:9229';
process.env.DATABASE_URL_AUDIT =
  process.env.DATABASE_URL_AUDIT ??
  'postgresql://segurasist:segurasist@localhost:5432/segurasist?schema=public';
process.env.DATABASE_URL_BYPASS =
  process.env.DATABASE_URL_BYPASS ??
  'postgresql://segurasist:segurasist@localhost:5432/segurasist?schema=public';

interface LoginResp {
  idToken?: string;
  accessToken: string;
}
interface MeResp {
  tenantId: string | null;
}
interface AuditListResp {
  items: Array<{
    id: string;
    tenantId: string;
    action: string;
    resourceType: string;
    occurredAt: string;
    rowHash: string;
    prevHash: string;
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

async function loginAdminPool(server: Server, email: string, pwd: string): Promise<string> {
  const res = await request(server)
    .post('/v1/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password: pwd });
  if (res.status !== 200) throw new Error(`login ${email} fail: ${res.status}`);
  const body = res.body as LoginResp;
  if (!body.idToken) throw new Error('sin idToken');
  return body.idToken;
}

describe('Audit Log E2E (GET /v1/audit/log)', () => {
  let app: INestApplication;
  let server: Server;
  let macToken: string;
  let supervisorToken: string;
  let operatorToken: string;
  let insuredToken: string;
  let macTenantId: string;
  const insertedIds: string[] = [];

  beforeAll(async () => {
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;

    macToken = await loginAdminPool(server, 'admin@mac.local', 'Admin123!');
    supervisorToken = await loginAdminPool(server, 'supervisor@mac.local', 'Demo123!');
    operatorToken = await loginAdminPool(server, 'operator@mac.local', 'Demo123!');

    // Insured vive en otra pool — token via AdminInitiateAuth (igual que rbac.e2e-spec).
    const cog = new CognitoIdentityProviderClient({
      region: process.env.COGNITO_REGION ?? 'local',
      endpoint: process.env.COGNITO_ENDPOINT ?? 'http://0.0.0.0:9229',
    });
    const insuredOut = await cog.send(
      new AdminInitiateAuthCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID_INSURED,
        ClientId: process.env.COGNITO_CLIENT_ID_INSURED,
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: 'insured.demo@mac.local', PASSWORD: 'Demo123!' },
      }),
    );
    insuredToken = insuredOut.AuthenticationResult?.IdToken ?? '';
    if (!insuredToken) throw new Error('insured sin idToken');

    const me = await request(server).get('/v1/auth/me').set('Authorization', `Bearer ${macToken}`);
    macTenantId = (me.body as MeResp).tenantId as string;

    // Sembrar 3 audit events para que el read tenga data garantizada (los
    // mutation tests de otros specs no necesariamente corren antes y RLS
    // limita lo que vemos).
    const writer = app.get(AuditWriterService);
    for (let i = 0; i < 3; i++) {
      await writer.record({
        tenantId: macTenantId,
        actorId: undefined,
        action: i === 0 ? 'create' : i === 1 ? 'update' : 'delete',
        resourceType: 'audit_log_e2e',
        resourceId: `seed-${i}`,
        ip: '127.0.0.1',
        userAgent: 'jest',
        payloadDiff: { i },
        traceId: `audit-log-e2e-${i}`,
      });
    }

    // Trackear ids para cleanup
    const pc = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_AUDIT } } });
    try {
      const rows = await pc.auditLog.findMany({
        where: { tenantId: macTenantId, resourceType: 'audit_log_e2e' },
        select: { id: true },
      });
      insertedIds.push(...rows.map((r) => r.id));
    } finally {
      await pc.$disconnect();
    }
  }, 60_000);

  afterAll(async () => {
    if (insertedIds.length > 0) {
      const pc = new PrismaClient({
        datasources: { db: { url: process.env.DATABASE_URL_AUDIT } },
      });
      try {
        await pc.auditLog.deleteMany({ where: { id: { in: insertedIds } } });
      } finally {
        await pc.$disconnect();
      }
    }
    if (app) await app.close();
  });

  it('GET /v1/audit/log como admin_mac → 200 con items', async () => {
    const res = await request(server).get('/v1/audit/log').set('Authorization', `Bearer ${macToken}`);
    expect(res.status).toBe(200);
    const body = res.body as AuditListResp;
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    body.items.forEach((it) => {
      expect(it.tenantId).toBe(macTenantId);
      expect(typeof it.rowHash).toBe('string');
      expect(it.rowHash.length).toBe(64);
    });
  });

  it('GET /v1/audit/log como supervisor → 200', async () => {
    const res = await request(server).get('/v1/audit/log').set('Authorization', `Bearer ${supervisorToken}`);
    expect(res.status).toBe(200);
  });

  it('GET /v1/audit/log como operator → 403', async () => {
    const res = await request(server).get('/v1/audit/log').set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /v1/audit/log como insured → 403', async () => {
    const res = await request(server).get('/v1/audit/log').set('Authorization', `Bearer ${insuredToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /v1/audit/log?action=create filtra correctamente', async () => {
    const res = await request(server)
      .get('/v1/audit/log?action=create&limit=200')
      .set('Authorization', `Bearer ${macToken}`);
    expect(res.status).toBe(200);
    const body = res.body as AuditListResp;
    expect(body.items.length).toBeGreaterThan(0);
    body.items.forEach((it) => expect(it.action).toBe('create'));
  });

  it('GET /v1/audit/log?from filtra por fecha', async () => {
    const res = await request(server)
      .get(`/v1/audit/log?from=2026-01-01T00:00:00.000Z`)
      .set('Authorization', `Bearer ${macToken}`);
    expect(res.status).toBe(200);
    const body = res.body as AuditListResp;
    body.items.forEach((it) =>
      expect(new Date(it.occurredAt).getTime()).toBeGreaterThanOrEqual(
        new Date('2026-01-01T00:00:00Z').getTime(),
      ),
    );
  });

  it('keyset pagination: limit=2 + cursor → segunda página distinta de la primera', async () => {
    const first = await request(server)
      .get('/v1/audit/log?limit=2&resourceType=audit_log_e2e')
      .set('Authorization', `Bearer ${macToken}`);
    expect(first.status).toBe(200);
    const firstBody = first.body as AuditListResp;
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await request(server)
      .get(
        `/v1/audit/log?limit=2&resourceType=audit_log_e2e&cursor=${encodeURIComponent(firstBody.nextCursor as string)}`,
      )
      .set('Authorization', `Bearer ${macToken}`);
    expect(second.status).toBe(200);
    const secondBody = second.body as AuditListResp;
    expect(secondBody.items.length).toBeGreaterThanOrEqual(1);
    const firstIds = new Set(firstBody.items.map((i) => i.id));
    secondBody.items.forEach((it) => expect(firstIds.has(it.id)).toBe(false));
  });
});
