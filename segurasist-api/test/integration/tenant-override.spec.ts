/**
 * Integration test del flujo de tenant override (S3-08).
 *
 * Monta una mini-app NestJS con el AuditInterceptor + el
 * TenantOverrideAuditInterceptor encadenados (mismo orden que producción), y
 * un controller stub que simula `req.tenant` y `req.tenantOverride` (lo que
 * en producción setea el JwtAuthGuard).
 *
 * Verifica:
 *  1. GET con override → recordOverrideUse() llamado con el payload correcto.
 *  2. POST con override → AuditInterceptor escribe row con _overrideTenant en
 *     payloadDiff (para que la vista 360 pueda filtrarlo).
 */
import type { Server } from 'node:http';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import request from 'supertest';
import { AuditInterceptor } from '../../src/common/interceptors/audit.interceptor';
import { TenantOverrideAuditInterceptor } from '../../src/common/interceptors/tenant-override-audit.interceptor';
import { AuditWriterService } from '../../src/modules/audit/audit-writer.service';

const SUPER = 'super-1';
const OVERRIDE_TENANT = '11111111-1111-4111-8111-111111111111';

@Controller({ path: 'insureds', version: '1' })
class StubInsuredsController {
  @Get()
  list(@Req() req: FastifyRequest): unknown {
    (req as unknown as { tenant?: { id: string } }).tenant = { id: OVERRIDE_TENANT };
    (req as unknown as { user?: { id: string } }).user = { id: SUPER };
    (req as unknown as { tenantOverride?: { active: boolean; overrideTenant: string } }).tenantOverride = {
      active: true,
      overrideTenant: OVERRIDE_TENANT,
    };
    return [];
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: FastifyRequest, @Body() _body: unknown): unknown {
    (req as unknown as { tenant?: { id: string } }).tenant = { id: OVERRIDE_TENANT };
    (req as unknown as { user?: { id: string } }).user = { id: SUPER };
    (req as unknown as { tenantOverride?: { active: boolean; overrideTenant: string } }).tenantOverride = {
      active: true,
      overrideTenant: OVERRIDE_TENANT,
    };
    return { id: 'created-1' };
  }
}

@UseInterceptors(AuditInterceptor, TenantOverrideAuditInterceptor)
@Controller({ path: 'insureds', version: '1' })
class WrappedController extends StubInsuredsController {}

@Module({
  controllers: [WrappedController],
  providers: [AuditInterceptor, TenantOverrideAuditInterceptor],
})
class TestOverrideModule {}

describe('Tenant override integration (S3-08, sin Postgres)', () => {
  let app: INestApplication;
  let server: Server;
  let writer: AuditWriterService;
  let recordSpy: jest.SpyInstance;
  let recordOverrideSpy: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestOverrideModule],
      providers: [AuditWriterService],
    })
      .overrideProvider(AuditWriterService)
      .useValue({
        record: jest.fn().mockResolvedValue(undefined),
        recordOverrideUse: jest.fn().mockResolvedValue(undefined),
      } as unknown as AuditWriterService)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ trustProxy: true }));
    app.enableVersioning();
    writer = moduleRef.get<AuditWriterService>(AuditWriterService);
    app.useGlobalInterceptors(new AuditInterceptor(writer), new TenantOverrideAuditInterceptor(writer));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;
    recordSpy = writer.record as unknown as jest.SpyInstance;
    recordOverrideSpy = writer.recordOverrideUse as unknown as jest.SpyInstance;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    recordSpy.mockClear();
    recordOverrideSpy.mockClear();
  });

  it('GET con tenantOverride → recordOverrideUse llamado con el override tenant', async () => {
    const res = await request(server).get('/v1/insureds');
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(recordOverrideSpy).toHaveBeenCalledTimes(1);
    const arg = recordOverrideSpy.mock.calls[0][0];
    expect(arg.actorId).toBe(SUPER);
    expect(arg.overrideTenant).toBe(OVERRIDE_TENANT);
    expect(arg.requestPath).toBe('/v1/insureds');
    // El AuditInterceptor estándar NO debe haber escrito (es GET).
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it('POST con tenantOverride → AuditInterceptor escribe row con _overrideTenant en payloadDiff', async () => {
    const res = await request(server)
      .post('/v1/insureds')
      .set('Content-Type', 'application/json')
      .send({ fullName: 'Juan' });
    expect(res.status).toBe(201);
    await new Promise((r) => setImmediate(r));
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const ev = recordSpy.mock.calls[0][0];
    expect(ev.tenantId).toBe(OVERRIDE_TENANT);
    expect(ev.actorId).toBe(SUPER);
    expect(ev.payloadDiff._overrideTenant).toBe(OVERRIDE_TENANT);
    expect(ev.payloadDiff._overriddenBy).toBe('admin_segurasist');
    // En mutaciones NO duplicamos via recordOverrideUse: el row principal ya
    // documenta la operación cross-tenant.
    expect(recordOverrideSpy).not.toHaveBeenCalled();
  });
});
