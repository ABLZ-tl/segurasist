/**
 * E2E del endpoint GET /v1/batches/template (Sprint 1 — S1-04).
 *
 * Sigue el patrón de `rbac.e2e-spec.ts`: habla contra cognito-local REAL en
 * 0.0.0.0:9229, levanta la AppModule completa con FastifyAdapter. NO mockea
 * ni Cognito ni la generación del XLSX.
 *
 * Pre-requisitos:
 *   - cognito-local arriba con `./scripts/cognito-local-bootstrap.sh`
 *   - `prisma db seed` corrido (5 users en tenant `mac`)
 *   - .env apuntando a los pools del bootstrap
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
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

process.env.COGNITO_ENDPOINT = 'http://0.0.0.0:9229';

type Role = 'admin_segurasist' | 'admin_mac' | 'operator' | 'supervisor' | 'insured';

const CREDS: Record<Role, { email: string; password: string }> = {
  admin_segurasist: { email: 'superadmin@segurasist.local', password: 'Demo123!' },
  admin_mac: { email: 'admin@mac.local', password: 'Admin123!' },
  operator: { email: 'operator@mac.local', password: 'Demo123!' },
  supervisor: { email: 'supervisor@mac.local', password: 'Demo123!' },
  insured: { email: 'insured.demo@mac.local', password: 'Demo123!' },
};

interface LoginResponseBody {
  idToken?: string;
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

describe('Layouts E2E — GET /v1/batches/template', () => {
  let app: INestApplication;
  let server: Server;
  const tokens: Partial<Record<Role, string>> = {};

  beforeAll(async () => {
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;

    const adminRoles: Role[] = ['admin_segurasist', 'admin_mac', 'operator', 'supervisor'];
    for (const role of adminRoles) {
      const { email, password } = CREDS[role];
      const res = await request(server)
        .post('/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send({ email, password });
      if (res.status !== 200) {
        throw new Error(
          `[setup] login falló para ${role} (${email}) → ${res.status} ${JSON.stringify(res.body)}`,
        );
      }
      const body = res.body as LoginResponseBody;
      if (!body.idToken) throw new Error(`[setup] login para ${role} no devolvió idToken`);
      tokens[role] = body.idToken;
    }

    const cog = new CognitoIdentityProviderClient({
      region: process.env.COGNITO_REGION ?? 'local',
      endpoint: process.env.COGNITO_ENDPOINT ?? 'http://0.0.0.0:9229',
    });
    const insuredOut = await cog.send(
      new AdminInitiateAuthCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID_INSURED,
        ClientId: process.env.COGNITO_CLIENT_ID_INSURED,
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: {
          USERNAME: CREDS.insured.email,
          PASSWORD: CREDS.insured.password,
        },
      }),
    );
    const insuredId = insuredOut.AuthenticationResult?.IdToken;
    if (!insuredId) throw new Error('[setup] no idToken para insured');
    tokens.insured = insuredId;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('sin auth → 401', async () => {
    const res = await request(server).get('/v1/batches/template');
    expect(res.status).toBe(401);
  });

  it('como insured → 403 (rol no permitido)', async () => {
    const res = await request(server)
      .get('/v1/batches/template')
      .set('Authorization', `Bearer ${tokens.insured}`);
    expect(res.status).toBe(403);
  }, 30_000);

  it('como supervisor → 403 (rol no permitido)', async () => {
    const res = await request(server)
      .get('/v1/batches/template')
      .set('Authorization', `Bearer ${tokens.supervisor}`);
    expect(res.status).toBe(403);
  }, 30_000);

  it('como operator → 200, headers correctos, body XLSX válido', async () => {
    const res = await request(server)
      .get('/v1/batches/template')
      .set('Authorization', `Bearer ${tokens.operator}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const disp = res.headers['content-disposition'] as string | undefined;
    expect(disp).toBeDefined();
    expect(disp).toContain('attachment');
    expect(disp).toMatch(/filename="[^"]+\.xlsx"/);

    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.length).toBeGreaterThan(1024);
    // ZIP magic bytes (XLSX = ZIP)
    expect(body[0]).toBe(0x50);
    expect(body[1]).toBe(0x4b);
    expect(body[2]).toBe(0x03);
    expect(body[3]).toBe(0x04);

    // Re-parsea para asegurar XLSX válido y hojas correctas.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Asegurados', 'Instrucciones', 'Catálogos']);
  }, 30_000);

  it('como admin_mac → 200', async () => {
    const res = await request(server)
      .get('/v1/batches/template')
      .set('Authorization', `Bearer ${tokens.admin_mac}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(1024);
  }, 30_000);

  it('como admin_segurasist → 200', async () => {
    const res = await request(server)
      .get('/v1/batches/template')
      .set('Authorization', `Bearer ${tokens.admin_segurasist}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).length).toBeGreaterThan(1024);
  }, 30_000);
});
