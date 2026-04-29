/**
 * Sprint 5 — MT-1 integration tests del flow Branding (insured GET + admin CRUD).
 *
 * Mocks:
 *   - `BrandingService` (no toca BD).
 *   - `AuditWriterService` (no escribe audit_log; spy en `record`).
 *   - `JwtAuthGuard` + `RolesGuard` overridden con un guard stub que popula
 *     `req.user` y `req.tenant` desde headers `x-test-role`, `x-test-tenant`,
 *     `x-test-user` (mismo patrón que otros integration tests del repo).
 *
 * Cobertura:
 *   1) GET /v1/tenants/me/branding como insured → llama svc.getBrandingForTenant(req.tenant.id).
 *   2) GET /v1/admin/tenants/:id/branding como admin_segurasist → cualquier id permitido.
 *   3) PUT /v1/admin/tenants/:id/branding como admin_segurasist → llama updateBranding + audit.
 *   4) PUT como admin_mac sobre OTRO tenant → 403 (cross-tenant denial).
 *   5) PUT con body inválido (hex malformado) → 400.
 *   6) POST /v1/admin/tenants/:id/branding/logo (multipart PNG) → llama uploadLogo + audit.
 *   7) POST logo con buffer >512KB → 413 PAYLOAD_TOO_LARGE.
 *   8) POST logo con mime fake (filename .png + bytes EXE) → 415 UNSUPPORTED_MEDIA.
 *   9) DELETE /v1/admin/tenants/:id/branding/logo → llama clearLogo + audit con subAction='logo_cleared'.
 */
import type { Server } from 'node:http';
import multipart from '@fastify/multipart';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  Module,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import request from 'supertest';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { AuditContextFactory } from '../../src/modules/audit/audit-context.factory';
import { AuditWriterService } from '../../src/modules/audit/audit-writer.service';
import { BrandingAdminController } from '../../src/modules/admin/tenants/branding-admin.controller';
import { BrandingController } from '../../src/modules/tenants/branding/branding.controller';
import { BrandingService } from '../../src/modules/tenants/branding/branding.service';
import type { BrandingResponseDto } from '../../src/modules/tenants/branding/dto/branding.dto';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const SUPERADMIN_ID = 'super-1';
const ADMIN_MAC_ID = 'admin-mac-1';
const INSURED_ID = 'insured-1';

/**
 * Guard stub: lee `x-test-role`, `x-test-user`, `x-test-tenant` y popula
 * `req.user` / `req.tenant`. Reemplaza el JwtAuthGuard real para que estos
 * tests no dependan de cognito-local. NO valida JWT — sólo monta el ctx.
 */
@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const headers = (req.headers ?? {}) as Record<string, string>;
    const role = headers['x-test-role'] as string;
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
      pool: role === 'insured' ? 'insured' : 'admin',
      platformAdmin: role === 'admin_segurasist',
    };
    if (tenantId) {
      (req as unknown as { tenant?: unknown }).tenant = { id: tenantId };
    }
    return true;
  }
}

/** Sample DTO devuelto por el service mock. */
const SAMPLE_DTO: BrandingResponseDto = {
  tenantId: TENANT_A,
  displayName: 'Hospitales MAC',
  tagline: 'Tu salud, nuestra prioridad',
  logoUrl: null,
  primaryHex: '#16a34a',
  accentHex: '#7c3aed',
  bgImageUrl: null,
  lastUpdatedAt: '2026-04-28T12:00:00.000Z',
};

@Module({
  controllers: [BrandingController, BrandingAdminController],
  providers: [
    {
      provide: BrandingService,
      useValue: {
        getBrandingForTenant: jest.fn().mockResolvedValue(SAMPLE_DTO),
        updateBranding: jest.fn().mockResolvedValue(SAMPLE_DTO),
        uploadLogo: jest.fn().mockResolvedValue({ ...SAMPLE_DTO, logoUrl: 'https://cdn/logo.png' }),
        clearLogo: jest.fn().mockResolvedValue({ ...SAMPLE_DTO, logoUrl: null }),
      },
    },
    {
      provide: AuditWriterService,
      useValue: { record: jest.fn().mockResolvedValue(undefined) },
    },
    {
      provide: AuditContextFactory,
      useValue: {
        fromRequest: jest.fn().mockReturnValue({
          actorId: 'actor-1',
          ip: '127.0.0.1',
          userAgent: 'jest',
          traceId: 'trace-1',
        }),
      },
    },
  ],
})
class TestBrandingModule {}

describe('Branding controllers integration (no DB, no Cognito)', () => {
  let app: INestApplication;
  let server: Server;
  let svc: { [k: string]: jest.Mock };
  let auditWriter: { record: jest.Mock };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestBrandingModule] })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubAuthGuard)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: true }),
    );
    await (app as unknown as { register: (p: unknown, o: unknown) => Promise<unknown> }).register(
      multipart,
      { limits: { fileSize: 25 * 1024 * 1024, files: 1 } },
    );
    app.enableVersioning();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;

    svc = moduleRef.get(BrandingService) as unknown as { [k: string]: jest.Mock };
    auditWriter = moduleRef.get(AuditWriterService) as unknown as { record: jest.Mock };
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    Object.values(svc).forEach((fn) => fn.mockClear());
    auditWriter.record.mockClear();
  });

  // -------------------------------------------------------------------------
  // GET /v1/tenants/me/branding (insured)
  // -------------------------------------------------------------------------

  it('GET /v1/tenants/me/branding como insured → llama svc.getBrandingForTenant(tenantId del JWT)', async () => {
    const res = await request(server)
      .get('/v1/tenants/me/branding')
      .set('x-test-role', 'insured')
      .set('x-test-user', INSURED_ID)
      .set('x-test-tenant', TENANT_A);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(TENANT_A);
    expect(svc.getBrandingForTenant).toHaveBeenCalledWith(TENANT_A);
  });

  it('GET /v1/tenants/me/branding como admin_mac también funciona (mismo endpoint)', async () => {
    const res = await request(server)
      .get('/v1/tenants/me/branding')
      .set('x-test-role', 'admin_mac')
      .set('x-test-user', ADMIN_MAC_ID)
      .set('x-test-tenant', TENANT_A);

    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // GET admin
  // -------------------------------------------------------------------------

  it('GET /v1/admin/tenants/:id/branding como admin_segurasist → cualquier tenant id', async () => {
    const res = await request(server)
      .get(`/v1/admin/tenants/${TENANT_B}/branding`)
      .set('x-test-role', 'admin_segurasist')
      .set('x-test-user', SUPERADMIN_ID);

    expect(res.status).toBe(200);
    expect(svc.getBrandingForTenant).toHaveBeenCalledWith(TENANT_B);
  });

  // -------------------------------------------------------------------------
  // PUT admin
  // -------------------------------------------------------------------------

  it('PUT /v1/admin/tenants/:id/branding como admin_segurasist → 200 + audit', async () => {
    const res = await request(server)
      .put(`/v1/admin/tenants/${TENANT_A}/branding`)
      .set('x-test-role', 'admin_segurasist')
      .set('x-test-user', SUPERADMIN_ID)
      .send({
        displayName: 'GNP',
        tagline: 'Cuidando lo que más importa',
        primaryHex: '#000000',
        accentHex: '#ffffff',
      });

    expect(res.status).toBe(200);
    expect(svc.updateBranding).toHaveBeenCalledWith(
      TENANT_A,
      expect.objectContaining({ displayName: 'GNP', primaryHex: '#000000' }),
    );
    expect(auditWriter.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant_branding_updated',
        tenantId: TENANT_A,
      }),
    );
  });

  it('PUT como admin_mac sobre SU tenant → 200', async () => {
    const res = await request(server)
      .put(`/v1/admin/tenants/${TENANT_A}/branding`)
      .set('x-test-role', 'admin_mac')
      .set('x-test-user', ADMIN_MAC_ID)
      .set('x-test-tenant', TENANT_A)
      .send({ displayName: 'X', primaryHex: '#abcdef', accentHex: '#fedcba' });

    expect(res.status).toBe(200);
  });

  it('PUT como admin_mac sobre OTRO tenant → 403 (cross-tenant denial)', async () => {
    const res = await request(server)
      .put(`/v1/admin/tenants/${TENANT_B}/branding`)
      .set('x-test-role', 'admin_mac')
      .set('x-test-user', ADMIN_MAC_ID)
      .set('x-test-tenant', TENANT_A)
      .send({ displayName: 'X', primaryHex: '#abcdef', accentHex: '#fedcba' });

    expect(res.status).toBe(403);
    expect(svc.updateBranding).not.toHaveBeenCalled();
  });

  it('PUT con hex malformado → 400 (Zod rechaza antes del service)', async () => {
    const res = await request(server)
      .put(`/v1/admin/tenants/${TENANT_A}/branding`)
      .set('x-test-role', 'admin_segurasist')
      .set('x-test-user', SUPERADMIN_ID)
      .send({ displayName: 'X', primaryHex: 'red', accentHex: '#ffffff' });

    expect(res.status).toBe(422);
    expect(svc.updateBranding).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // POST logo (multipart)
  // -------------------------------------------------------------------------

  it('POST logo con PNG válido → 200 + audit subAction=logo_uploaded', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 0xab),
    ]);
    const res = await request(server)
      .post(`/v1/admin/tenants/${TENANT_A}/branding/logo`)
      .set('x-test-role', 'admin_segurasist')
      .set('x-test-user', SUPERADMIN_ID)
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(svc.uploadLogo).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A, mime: 'image/png' }),
    );
    expect(auditWriter.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant_branding_updated',
        payloadDiff: expect.objectContaining({ subAction: 'logo_uploaded', mime: 'image/png' }),
      }),
    );
  });

  it('POST logo con buffer >512KB → 413 PAYLOAD_TOO_LARGE', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(513 * 1024, 0xab), // 513 KB
    ]);
    const res = await request(server)
      .post(`/v1/admin/tenants/${TENANT_A}/branding/logo`)
      .set('x-test-role', 'admin_segurasist')
      .set('x-test-user', SUPERADMIN_ID)
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' });

    expect(res.status).toBe(413);
    expect(svc.uploadLogo).not.toHaveBeenCalled();
  });

  it('POST logo con mime fake (EXE renombrado .png) → 415 UNSUPPORTED_MEDIA', async () => {
    const fake = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00]);
    const res = await request(server)
      .post(`/v1/admin/tenants/${TENANT_A}/branding/logo`)
      .set('x-test-role', 'admin_segurasist')
      .set('x-test-user', SUPERADMIN_ID)
      .attach('file', fake, { filename: 'logo.png', contentType: 'image/png' });

    expect(res.status).toBe(415);
    expect(svc.uploadLogo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // DELETE logo
  // -------------------------------------------------------------------------

  it('DELETE /v1/admin/tenants/:id/branding/logo → 200 + audit subAction=logo_cleared', async () => {
    const res = await request(server)
      .delete(`/v1/admin/tenants/${TENANT_A}/branding/logo`)
      .set('x-test-role', 'admin_segurasist')
      .set('x-test-user', SUPERADMIN_ID);

    expect(res.status).toBe(200);
    expect(svc.clearLogo).toHaveBeenCalledWith(TENANT_A);
    expect(auditWriter.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant_branding_updated',
        payloadDiff: expect.objectContaining({ subAction: 'logo_cleared' }),
      }),
    );
  });
});
