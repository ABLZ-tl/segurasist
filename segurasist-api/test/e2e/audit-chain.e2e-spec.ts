/**
 * E2E del audit hash chain (Sprint 1 hardening final).
 *
 * Strategy:
 *   1. Bootstrap AppModule normal (con DATABASE_URL_AUDIT apuntando al postgres
 *      docker-compose: el AuditWriterService persiste a la BD real).
 *   2. Login como admin_mac y como superadmin (admin_segurasist).
 *   3. Sembrar 3 entries vía AuditWriterService inyectado directamente
 *      (los handlers reales de mutación son stubs `NotImplementedException`
 *      Sprint 0; el interceptor sólo persiste en éxito, así que vamos por el
 *      writer directo — el contrato del chain es lo que probamos, no el
 *      mapeo HTTP→audit que ya cubre `audit-interceptor.spec.ts`).
 *   4. Hit GET /v1/audit/verify-chain como superadmin → valid=true, totalRows≥3.
 *   5. Tampering manual (UPDATE bypass-RLS de payload_diff de la fila intermedia)
 *      → re-hit verify-chain → valid=false, brokenAtId apunta a esa fila.
 *
 * Cleanup: borramos el subset de filas insertadas por el spec antes de cerrar.
 *
 * Pre-requisitos:
 *   - postgres docker arriba (segurasist:segurasist@localhost:5432).
 *   - cognito-local arriba con admin_mac y superadmin seedeados.
 *   - DATABASE_URL_AUDIT y DATABASE_URL_BYPASS apuntando al docker-compose.
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
import { AuditWriterService } from '../../src/modules/audit/audit-writer.service';

process.env.COGNITO_ENDPOINT = 'http://0.0.0.0:9229';
process.env.DATABASE_URL_AUDIT =
  process.env.DATABASE_URL_AUDIT ??
  'postgresql://segurasist:segurasist@localhost:5432/segurasist?schema=public';
process.env.DATABASE_URL_BYPASS =
  process.env.DATABASE_URL_BYPASS ??
  'postgresql://segurasist:segurasist@localhost:5432/segurasist?schema=public';

interface LoginResponseBody {
  idToken?: string;
  accessToken: string;
}

interface MeResponseBody {
  tenantId: string | null;
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

describe('Audit chain E2E (verify-chain endpoint + tampering detection)', () => {
  let app: INestApplication;
  let server: Server;
  let macTenantId: string;
  let superToken: string;
  let writer: AuditWriterService;
  // Track de IDs creadas por este spec para limpiar al final (audit_log no
  // tiene cascade delete via tenant — borramos sólo lo nuestro).
  const insertedIds: string[] = [];

  beforeAll(async () => {
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;
    writer = app.get(AuditWriterService);

    // Login como admin_mac para obtener su tenant_id real.
    const macLogin = await request(server)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'admin@mac.local', password: 'Admin123!' });
    if (macLogin.status !== 200) {
      throw new Error(`[audit-chain] admin_mac login failed: ${macLogin.status}`);
    }
    const macToken = (macLogin.body as LoginResponseBody).idToken;
    if (!macToken) throw new Error('[audit-chain] admin_mac sin idToken');
    const meRes = await request(server).get('/v1/auth/me').set('Authorization', `Bearer ${macToken}`);
    if (meRes.status !== 200 || !(meRes.body as MeResponseBody).tenantId) {
      throw new Error('[audit-chain] /v1/auth/me admin_mac sin tenantId');
    }
    macTenantId = (meRes.body as MeResponseBody).tenantId as string;

    // Login como superadmin para hits de verify-chain.
    const superLogin = await request(server)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'superadmin@segurasist.local', password: 'Demo123!' });
    if (superLogin.status !== 200) {
      throw new Error(`[audit-chain] superadmin login failed: ${superLogin.status}`);
    }
    const sToken = (superLogin.body as LoginResponseBody).idToken;
    if (!sToken) throw new Error('[audit-chain] superadmin sin idToken');
    superToken = sToken;
  }, 60_000);

  afterAll(async () => {
    // Cleanup: borramos las filas que insertamos (vía bypass URL).
    if (insertedIds.length > 0) {
      const pc = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_AUDIT } } });
      try {
        await pc.auditLog.deleteMany({ where: { id: { in: insertedIds } } });
      } finally {
        await pc.$disconnect();
      }
    }
    if (app) await app.close();
  });

  it('siembra 3 audit events vía AuditWriterService → verify-chain devuelve valid=true', async () => {
    const before = await countAuditRows(macTenantId);
    // 3 mutaciones simuladas como las que el AuditInterceptor escribiría.
    await writer.record({
      tenantId: macTenantId,
      actorId: undefined,
      action: 'create',
      resourceType: 'users',
      resourceId: undefined,
      ip: '127.0.0.1',
      userAgent: 'jest',
      payloadDiff: { body: { fullName: 'Sample 1' } },
      traceId: 'e2e-chain-1',
    });
    await writer.record({
      tenantId: macTenantId,
      actorId: undefined,
      action: 'delete',
      resourceType: 'users',
      resourceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      ip: '127.0.0.1',
      userAgent: 'jest',
      payloadDiff: null,
      traceId: 'e2e-chain-2',
    });
    await writer.record({
      tenantId: macTenantId,
      actorId: undefined,
      action: 'update',
      resourceType: 'users',
      resourceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      ip: '127.0.0.1',
      userAgent: 'jest',
      payloadDiff: { body: { fullName: 'Sample 1 Updated' } },
      traceId: 'e2e-chain-3',
    });

    // Trackear los IDs nuevos para cleanup.
    const newIds = await fetchRecentIds(macTenantId, before);
    insertedIds.push(...newIds);
    expect(newIds.length).toBeGreaterThanOrEqual(3);

    // Hit verify-chain como superadmin.
    const res = await request(server)
      .get(`/v1/audit/verify-chain?tenantId=${macTenantId}`)
      .set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    const body = res.body as { valid: boolean; totalRows: number; brokenAtId?: string };
    expect(body.valid).toBe(true);
    expect(body.totalRows).toBeGreaterThanOrEqual(3);
    expect(body.brokenAtId).toBeUndefined();
  }, 60_000);

  it('tampering manual del payload_diff de fila intermedia → verify-chain valid=false, brokenAtId correcto', async () => {
    // Necesitamos al menos 2 filas insertadas en el test anterior. Tomamos
    // la del medio (índice 1) e injectamos un payload_diff distinto bypass-RLS.
    expect(insertedIds.length).toBeGreaterThanOrEqual(2);
    const target = insertedIds[1];
    expect(typeof target).toBe('string');

    const pc = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_AUDIT } } });
    try {
      await pc.auditLog.update({
        where: { id: target },
        data: { payloadDiff: { tampered: true, body: { fullName: 'EVIL' } } },
      });
    } finally {
      await pc.$disconnect();
    }

    const res = await request(server)
      .get(`/v1/audit/verify-chain?tenantId=${macTenantId}`)
      .set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
    const body = res.body as { valid: boolean; brokenAtId?: string; totalRows: number };
    expect(body.valid).toBe(false);
    expect(body.brokenAtId).toBe(target);
  }, 60_000);

  it('verify-chain rechaza tenantId malformed con 400', async () => {
    const res = await request(server)
      .get(`/v1/audit/verify-chain?tenantId=not-a-uuid`)
      .set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(400);
  });
});

async function countAuditRows(tenantId: string): Promise<number> {
  const pc = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_AUDIT } } });
  try {
    return pc.auditLog.count({ where: { tenantId } });
  } finally {
    await pc.$disconnect();
  }
}

async function fetchRecentIds(tenantId: string, sinceCount: number): Promise<string[]> {
  const pc = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_AUDIT } } });
  try {
    const rows = await pc.auditLog.findMany({
      where: { tenantId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      skip: sinceCount,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  } finally {
    await pc.$disconnect();
  }
}
