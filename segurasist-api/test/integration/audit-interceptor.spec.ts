/**
 * Integration test del AuditInterceptor: monta una mini-app NestJS con un
 * controller stub y verifica que cada mutación produce un evento en
 * AuditWriterService.record(...).
 *
 * No se conecta a Postgres: AuditWriterService recibe un cliente Prisma
 * mockeado vía DI. Esto cubre el contrato del interceptor (mapping de
 * método→acción, scrubbing del payload, propagación de tenantId/actorId)
 * sin requerir docker-compose.
 */
import type { Server } from 'node:http';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
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
import { AuditWriterService } from '../../src/modules/audit/audit-writer.service';

/**
 * Controller stub. Antes del pipeline NestJS no hay JwtAuthGuard, así que
 * inyectamos manualmente `req.tenant` y `req.user` desde headers para
 * simular el efecto del guard real.
 */
@Controller({ path: 'insureds', version: '1' })
class StubInsuredsController {
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: FastifyRequest, @Body() _body: unknown): unknown {
    (req as unknown as { tenant?: { id: string } }).tenant = { id: 'tenant-test' };
    (req as unknown as { user?: { id: string } }).user = { id: 'user-test' };
    return { id: 'created-1' };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: FastifyRequest, @Param('id') _id: string): void {
    (req as unknown as { tenant?: { id: string } }).tenant = { id: 'tenant-test' };
    (req as unknown as { user?: { id: string } }).user = { id: 'user-test' };
  }

  @Get()
  list(@Req() req: FastifyRequest): unknown {
    (req as unknown as { tenant?: { id: string } }).tenant = { id: 'tenant-test' };
    (req as unknown as { user?: { id: string } }).user = { id: 'user-test' };
    return [];
  }
}

/**
 * Wrapper que registra el interceptor a nivel controller. La asignación de
 * `req.tenant`/`req.user` ocurre en el handler antes de que `tap` corra
 * (porque tap se dispara con el resultado del handler).
 */
@UseInterceptors(AuditInterceptor)
@Controller({ path: 'insureds', version: '1' })
class WrappedController extends StubInsuredsController {}

@Module({
  controllers: [WrappedController],
  providers: [AuditInterceptor],
})
class TestAuditModule {}

describe('AuditInterceptor integration (E2E ligero, sin Postgres)', () => {
  let app: INestApplication;
  let server: Server;
  let recordSpy: jest.SpyInstance;
  let writer: AuditWriterService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAuditModule],
      providers: [AuditWriterService],
    })
      .overrideProvider(AuditWriterService)
      .useValue({ record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditWriterService)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ trustProxy: true }));
    app.enableVersioning();
    // Construimos el interceptor manualmente con el writer mockeado y lo
    // registramos GLOBAL para que las rutas lo apliquen.
    writer = moduleRef.get<AuditWriterService>(AuditWriterService);
    app.useGlobalInterceptors(new AuditInterceptor(writer));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;
    recordSpy = writer.record as unknown as jest.SpyInstance;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    recordSpy.mockClear();
  });

  it('POST /v1/insureds genera un evento `create` con resourceType=insureds, sin password', async () => {
    const res = await request(server)
      .post('/v1/insureds')
      .set('Content-Type', 'application/json')
      .send({ fullName: 'Juan', password: 'super-secret' });
    expect(res.status).toBe(201);
    // El interceptor dispara `tap` síncronamente con el resultado; el record
    // es fire-and-forget pero ya se llamó.
    await new Promise((r) => setImmediate(r));
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const ev = recordSpy.mock.calls[0][0];
    expect(ev).toMatchObject({
      action: 'create',
      resourceType: 'insureds',
      tenantId: 'tenant-test',
      actorId: 'user-test',
    });
    expect(JSON.stringify(ev.payloadDiff)).not.toContain('super-secret');
    expect(JSON.stringify(ev.payloadDiff)).toContain('[REDACTED]');
  });

  it('DELETE /v1/insureds/:id genera un evento `delete`', async () => {
    const res = await request(server).delete('/v1/insureds/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(res.status).toBe(204);
    await new Promise((r) => setImmediate(r));
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const ev = recordSpy.mock.calls[0][0];
    expect(ev.action).toBe('delete');
    expect(ev.resourceType).toBe('insureds');
    expect(ev.resourceId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });

  it('GET /v1/insureds NO genera evento de audit (read-only)', async () => {
    const res = await request(server).get('/v1/insureds');
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(recordSpy).not.toHaveBeenCalled();
  });
});
