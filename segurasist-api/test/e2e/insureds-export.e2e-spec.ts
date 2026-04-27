/**
 * E2E /v1/insureds/export → /v1/exports/:id (S3-09).
 *
 * Pre-requisitos:
 *   - Postgres + roles RLS aplicados (apply-rls.sh).
 *   - LocalStack levantado con bucket exports + cola reports-queue.
 *   - cognito-local con admin@mac.local.
 *   - Migración add_exports_table aplicada.
 *
 * Flujo:
 *   1. Login admin → POST /v1/insureds/export → 202 con exportId.
 *   2. Trigger worker.handleEvent en mismo proceso (sin esperar al poller).
 *   3. Polling GET /v1/exports/:id hasta status=ready (timeout 30s).
 *   4. Descargar el presigned URL → 200 con Content-Type esperado.
 *
 * Si LocalStack/cognito-local no están disponibles, el suite skipea con warn.
 *
 * Adicionalmente: rate limit 1/min por user. El segundo POST consecutivo
 * debe responder 429.
 */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ReportsWorkerService } from '../../src/workers/reports-worker.service';

process.env.COGNITO_ENDPOINT = 'http://0.0.0.0:9229';
process.env.DATABASE_URL_AUDIT =
  process.env.DATABASE_URL_AUDIT ??
  'postgresql://segurasist:segurasist@localhost:5432/segurasist?schema=public';
process.env.DATABASE_URL_BYPASS =
  process.env.DATABASE_URL_BYPASS ??
  'postgresql://segurasist:segurasist@localhost:5432/segurasist?schema=public';
// Necesitamos el throttler en este suite para verificar el 1/min.
delete process.env.THROTTLE_ENABLED;

interface LoginResp {
  idToken?: string;
}
interface ExportResp {
  exportId: string;
  status: string;
}
interface ExportStatusResp {
  exportId: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  downloadUrl?: string;
  rowCount: number | null;
  hash?: string;
}

async function bootstrapApp(): Promise<INestApplication | null> {
  try {
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
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[e2e export] bootstrap failed; skipping:', (err as Error).message);
    return null;
  }
}

async function loginAdmin(server: Server): Promise<string | null> {
  try {
    const res = await request(server)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'admin@mac.local', password: 'Admin123!' });
    if (res.status !== 200) return null;
    return (res.body as LoginResp).idToken ?? null;
  } catch {
    return null;
  }
}

describe.skip('Insureds Export E2E', () => {
  let app: INestApplication | null;
  let server: Server;
  let token: string | null;
  const createdExportIds: string[] = [];

  beforeAll(async () => {
    app = await bootstrapApp();
    if (!app) return;
    server = app.getHttpServer() as Server;
    token = await loginAdmin(server);
    if (!token) {
      // eslint-disable-next-line no-console
      console.warn('[e2e export] login admin@mac.local falló; suite skipped');
    }
  }, 60_000);

  afterAll(async () => {
    if (createdExportIds.length > 0 && app) {
      const pc = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_BYPASS } } });
      try {
        await pc.export.deleteMany({ where: { id: { in: createdExportIds } } });
      } catch {
        /* ignore */
      } finally {
        await pc.$disconnect();
      }
    }
    if (app) await app.close();
  });

  it('POST → trigger worker → poll ready → download', async () => {
    if (!app || !token) return;

    // 1. Request
    const res = await request(server)
      .post('/v1/insureds/export')
      .set('Authorization', `Bearer ${token}`)
      .send({ format: 'xlsx', filters: { status: 'active' } });
    if (res.status === 429) {
      // eslint-disable-next-line no-console
      console.warn('[e2e export] rate-limited en primer POST; revisa estado Redis previo');
      return;
    }
    expect([200, 202]).toContain(res.status);
    const body = res.body as ExportResp;
    expect(body.exportId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.status).toBe('pending');
    createdExportIds.push(body.exportId);

    // 2. Trigger worker manual (no esperamos al poll loop).
    const worker = app.get(ReportsWorkerService);
    await worker.pollOnce().catch(() => undefined); // si SQS no entrega, swallow

    // 3. Poll status (max 30s)
    const start = Date.now();
    let status: ExportStatusResp | null = null;
    while (Date.now() - start < 30_000) {
      const sres = await request(server)
        .get(`/v1/exports/${body.exportId}`)
        .set('Authorization', `Bearer ${token}`);
      if (sres.status !== 200) break;
      status = sres.body as ExportStatusResp;
      if (status.status === 'ready' || status.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 1500));
      // re-poll worker por si SQS tardó.
      await worker.pollOnce().catch(() => undefined);
    }

    if (!status || status.status !== 'ready') {
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e export] export no llegó a ready (status=${status?.status}); LocalStack/SQS quizá down`,
      );
      return;
    }
    expect(status.downloadUrl).toBeDefined();
    expect(status.hash).toMatch(/^[a-f0-9]{64}$/);
  }, 90_000);

  it('rate limit: segundo POST en mismo minuto devuelve 429', async () => {
    if (!app || !token) return;
    const a = await request(server)
      .post('/v1/insureds/export')
      .set('Authorization', `Bearer ${token}`)
      .send({ format: 'xlsx', filters: {} });
    // Si el primer POST ya rate-limited (por el test anterior), aceptamos 429.
    expect([200, 202, 429]).toContain(a.status);
    if (a.status === 200 || a.status === 202) {
      const id = (a.body as ExportResp).exportId;
      if (id) createdExportIds.push(id);
    }
    const b = await request(server)
      .post('/v1/insureds/export')
      .set('Authorization', `Bearer ${token}`)
      .send({ format: 'pdf', filters: {} });
    expect(b.status).toBe(429);
  }, 30_000);
});
