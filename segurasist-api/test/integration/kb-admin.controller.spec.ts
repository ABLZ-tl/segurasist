/**
 * Sprint 5 — S5-3 integration tests del KbAdminController (`/v1/admin/chatbot/kb`).
 *
 * Cobertura:
 *   1. GET list → llama svc.list con tenant del JWT.
 *   2. GET list con `q` → propaga q al service.
 *   3. POST create como admin_mac → tenant forzado al JWT.
 *   4. PUT /:id → svc.update.
 *   5. PATCH /:id (compat Sprint 4) → svc.update con vocab Sprint 4 normalizado.
 *   6. DELETE /:id → svc.softDelete + 204.
 *   7. POST /:id/test-match → svc.testMatch + score body.
 *   8. POST /import (CSV) → svc.importCsv.
 *   9. RLS cross-tenant: admin_mac de tenant A → svc invocado con tenantId A
 *      aún cuando el body pase tenantId B (defensa profundidad documentada).
 */
import type { Server } from 'node:http';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  Module,
} from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import request from 'supertest';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { KbAdminController } from '../../src/modules/chatbot/kb-admin/kb-admin.controller';
import { KbAdminService } from '../../src/modules/chatbot/kb-admin/kb-admin.service';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const headers = (req.headers ?? {}) as Record<string, string>;
    const role = headers['x-test-role'];
    const tenantId = headers['x-test-tenant'];
    const userId = headers['x-test-user'] ?? 'user-1';
    if (!role) return false;
    (req as unknown as { user?: unknown }).user = {
      id: userId,
      cognitoSub: userId,
      email: `${userId}@test.local`,
      role,
      scopes: [],
      mfaEnrolled: true,
      mfaVerified: true,
      pool: 'admin',
      platformAdmin: role === 'admin_segurasist',
    };
    if (tenantId) {
      (req as unknown as { tenant?: unknown }).tenant = { id: tenantId };
    }
    return true;
  }
}

const SAMPLE_VIEW = {
  id: ENTRY_ID,
  tenantId: TENANT_A,
  intent: 'coverages',
  title: 'Cobertura hospitalaria',
  body: 'Tu plan incluye habitación standard.',
  keywords: ['hospital', 'cobertura'],
  priority: 5,
  enabled: true,
  createdAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
};

@Module({
  controllers: [KbAdminController],
  providers: [
    {
      provide: KbAdminService,
      useValue: {
        list: jest.fn().mockResolvedValue({ items: [SAMPLE_VIEW], total: 1 }),
        getById: jest.fn().mockResolvedValue(SAMPLE_VIEW),
        create: jest.fn().mockResolvedValue(SAMPLE_VIEW),
        update: jest.fn().mockResolvedValue(SAMPLE_VIEW),
        softDelete: jest.fn().mockResolvedValue(undefined),
        testMatch: jest.fn().mockResolvedValue({
          matched: true,
          score: 2,
          matchedKeywords: ['hospital'],
          matchedSynonyms: [],
        }),
        importCsv: jest.fn().mockResolvedValue({ inserted: 2, updated: 0, skipped: 0, errors: [] }),
      },
    },
  ],
})
class TestKbAdminModule {}

describe('KbAdminController integration (no DB)', () => {
  let app: INestApplication;
  let server: Server;
  let svc: { [k: string]: jest.Mock };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestKbAdminModule] })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubAuthGuard)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: true }),
    );
    app.enableVersioning();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;

    svc = moduleRef.get(KbAdminService) as unknown as { [k: string]: jest.Mock };
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    Object.values(svc).forEach((fn) => fn.mockClear());
  });

  it('GET /v1/admin/chatbot/kb → propaga q + tenant del JWT', async () => {
    const res = await request(server)
      .get('/v1/admin/chatbot/kb?q=hospital&limit=10&offset=0')
      .set('x-test-role', 'admin_mac')
      .set('x-test-user', 'admin-1')
      .set('x-test-tenant', TENANT_A);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(svc.list).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A, roles: ['admin_mac'] }),
      expect.objectContaining({ q: 'hospital', limit: 10, offset: 0 }),
    );
  });

  it('POST /v1/admin/chatbot/kb create como admin_mac → caller.tenantId = JWT tenant', async () => {
    const res = await request(server)
      .post('/v1/admin/chatbot/kb')
      .set('x-test-role', 'admin_mac')
      .set('x-test-user', 'admin-1')
      .set('x-test-tenant', TENANT_A)
      .send({
        intent: 'claims',
        title: 'Reportar siniestro',
        body: 'Llama al 800...',
        keywords: ['claim', 'siniestro'],
        priority: 0,
        enabled: true,
        // intento override → service lo ignora porque no es superadmin
        tenantId: TENANT_B,
      });

    expect(res.status).toBe(201);
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['admin_mac'], tenantId: TENANT_A }),
      expect.objectContaining({ intent: 'claims', tenantId: TENANT_B }),
    );
  });

  it('PUT /v1/admin/chatbot/kb/:id → svc.update', async () => {
    const res = await request(server)
      .put(`/v1/admin/chatbot/kb/${ENTRY_ID}`)
      .set('x-test-role', 'admin_mac')
      .set('x-test-tenant', TENANT_A)
      .send({ title: 'Nuevo título' });
    expect(res.status).toBe(200);
    expect(svc.update).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A }),
      ENTRY_ID,
      expect.objectContaining({ title: 'Nuevo título' }),
    );
  });

  it('PATCH /:id compat Sprint 4: vocab category/question/answer normalizado', async () => {
    const res = await request(server)
      .patch(`/v1/admin/chatbot/kb/${ENTRY_ID}`)
      .set('x-test-role', 'admin_mac')
      .set('x-test-tenant', TENANT_A)
      .send({ priority: 99, category: 'general', question: 'Q?', answer: 'A.' });
    expect(res.status).toBe(200);
    expect(svc.update).toHaveBeenCalledWith(
      expect.anything(),
      ENTRY_ID,
      expect.objectContaining({
        priority: 99,
        intent: 'general',
        title: 'Q?',
        body: 'A.',
      }),
    );
  });

  it('DELETE /v1/admin/chatbot/kb/:id → 204', async () => {
    const res = await request(server)
      .delete(`/v1/admin/chatbot/kb/${ENTRY_ID}`)
      .set('x-test-role', 'admin_mac')
      .set('x-test-tenant', TENANT_A);
    expect(res.status).toBe(204);
    expect(svc.softDelete).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A }),
      ENTRY_ID,
    );
  });

  it('POST /:id/test-match → svc.testMatch + body con score', async () => {
    const res = await request(server)
      .post(`/v1/admin/chatbot/kb/${ENTRY_ID}/test-match`)
      .set('x-test-role', 'admin_mac')
      .set('x-test-tenant', TENANT_A)
      .send({ query: '¿qué hospital cubre?' });
    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(true);
    expect(res.body.score).toBe(2);
  });

  it('POST /import → svc.importCsv', async () => {
    const csv = ['intent,title,body,keywords', 'coverages,Plan,B,k1'].join('\n');
    const res = await request(server)
      .post('/v1/admin/chatbot/kb/import')
      .set('x-test-role', 'admin_mac')
      .set('x-test-tenant', TENANT_A)
      .send({ csv, upsert: false });
    expect(res.status).toBe(200);
    expect(svc.importCsv).toHaveBeenCalled();
    expect(res.body.inserted).toBe(2);
  });

  it('superadmin GET sin tenant header → list invoked sin tenantId', async () => {
    const res = await request(server)
      .get('/v1/admin/chatbot/kb')
      .set('x-test-role', 'admin_segurasist')
      .set('x-test-user', 'super-1');
    expect(res.status).toBe(200);
    expect(svc.list).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ['admin_segurasist'], tenantId: undefined }),
      expect.anything(),
    );
  });
});
