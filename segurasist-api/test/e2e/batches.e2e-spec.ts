/**
 * E2E batches — L4 magic-bytes rejection.
 *
 * Habla contra cognito-local (puerto 9229) para autenticarse como `admin_mac`.
 * Sube un archivo con extensión .xlsx pero contenido EXE → debe responder
 * 415 con Problem Details `UNSUPPORTED_FILE`.
 *
 * Pre-requisitos: mismos que `auth.e2e-spec.ts` y `rbac.e2e-spec.ts`:
 *   - cognito-local arriba (`./scripts/cognito-local-bootstrap.sh`)
 *   - Admin user `admin@mac.local` / `Admin123!` ya creado.
 */
import type { Server } from 'node:http';
import multipart from '@fastify/multipart';
import type { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

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
}

async function bootstrapApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: true }),
  );
  // multipart está registrado en main.ts pero no aquí; lo agregamos para que
  // el endpoint POST /v1/batches funcione bajo supertest.
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  app.enableVersioning();
  app.setGlobalPrefix('', { exclude: ['health/(.*)'] });
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('Batches E2E — L4 magic bytes', () => {
  let app: INestApplication;
  let server: Server;
  let idToken: string;

  beforeAll(async () => {
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;
    const res = await request(server)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (res.status !== 200) {
      throw new Error(`[setup] login admin_mac falló: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const body = res.body as LoginResponseBody;
    if (!body.idToken) throw new Error('[setup] login no devolvió idToken');
    idToken = body.idToken;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('POST /v1/batches con archivo EXE renombrado a .xlsx → 415 UNSUPPORTED_FILE', async () => {
    // Construir un buffer "EXE" mínimo: cabecera MZ + basura.
    const exe = Buffer.from([
      0x4d,
      0x5a,
      0x90,
      0x00,
      0x03,
      0x00,
      0x00,
      0x00,
      0x04,
      0x00,
      0x00,
      0x00,
      0xff,
      0xff,
      0x00,
      0x00,
      ...Array.from({ length: 64 }, (_, i) => i % 256),
    ]);

    const res = await request(server)
      .post('/v1/batches')
      .set('Authorization', `Bearer ${idToken}`)
      .attach('file', exe, {
        filename: 'malicious.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(415);
    const body = res.body as ProblemBody;
    expect(body.code).toBe('UNSUPPORTED_FILE');
    expect(body.status).toBe(415);
    expect(body.detail ?? '').toMatch(/no soportado/i);
  }, 30_000);
});
