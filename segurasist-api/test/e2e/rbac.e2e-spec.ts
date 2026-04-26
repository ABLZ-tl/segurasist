/**
 * E2E RBAC matrix — Sprint 1 (S1-02).
 *
 * Verifica los 5 roles del enum `UserRole` (admin_segurasist, admin_mac,
 * operator, supervisor, insured) contra los endpoints `@Roles()`-decorados
 * de los controladores reales.
 *
 * Habla contra cognito-local REAL (puerto 9229). NO mockea ni el SDK ni la
 * BD — sigue el patrón de `auth.e2e-spec.ts`. Pre-requisitos:
 *   - cognito-local arriba con `./scripts/cognito-local-bootstrap.sh`
 *   - prisma db seed corrido (5 users en tenant `mac`)
 *   - .env apuntando a los pools del bootstrap
 *
 * Matriz extraída leyendo los `@Roles()` reales de cada controller (Sprint 0
 * RBAC):
 *   tenants.controller         → @Roles('admin_segurasist') a nivel clase
 *   coverages.controller       → GET list: 4 roles (todos menos insured)
 *                                POST/PATCH/DELETE: solo admin_segurasist
 *   certificates.controller    → GET *  : todos los 5 roles
 *                                POST :id/reissue: admin_segurasist, admin_mac, operator
 *   audit.controller           → @Roles('admin_segurasist','admin_mac','supervisor')
 *   chat.controller            → POST messages: insured
 *                                GET history: insured, admin_mac, admin_segurasist, supervisor
 *                                GET kb: 5 roles
 *                                POST/PATCH kb: admin_segurasist
 *   users.controller           → @Roles('admin_mac','admin_segurasist') a nivel clase
 *   batches.controller         → POST: admin_mac, operator, admin_segurasist
 *                                GET list/findOne/errors: admin_mac, operator,
 *                                admin_segurasist, supervisor
 *
 * Aceptamos códigos {200,201,202,204,400,404,500} cuando el rol está
 * permitido, porque los servicios son stubs Sprint-0 que tiran
 * `NotImplementedException` (500) o devuelven null. Lo crítico es:
 *   - Rol permitido       ⇒ NO 401 ni 403
 *   - Rol NO permitido    ⇒ 403
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
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

// El issuer de cognito-local es `http://0.0.0.0:9229/<pool>`. Forzamos consistencia
// antes de instanciar la AppModule (Test.createTestingModule en bootstrapApp)
// para que `JwtAuthGuard` resuelva el JWKS contra el mismo host que cognito-local
// emite en el claim `iss`.
process.env.COGNITO_ENDPOINT = 'http://0.0.0.0:9229';

type Role = 'admin_segurasist' | 'admin_mac' | 'operator' | 'supervisor' | 'insured';

const ROLES: Role[] = ['admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured'];

const CREDS: Record<Role, { email: string; password: string }> = {
  admin_segurasist: { email: 'superadmin@segurasist.local', password: 'Demo123!' },
  admin_mac: { email: 'admin@mac.local', password: 'Admin123!' },
  operator: { email: 'operator@mac.local', password: 'Demo123!' },
  supervisor: { email: 'supervisor@mac.local', password: 'Demo123!' },
  insured: { email: 'insured.demo@mac.local', password: 'Demo123!' },
};

interface LoginResponseBody {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn: number;
}

interface MeResponseBody {
  id: string;
  email: string;
  role: string;
  tenant: { id: string };
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

describe('RBAC matrix (full role coverage)', () => {
  let app: INestApplication;
  let server: Server;
  const tokens: Partial<Record<Role, string>> = {};

  beforeAll(async () => {
    app = await bootstrapApp();
    server = app.getHttpServer() as Server;

    // Los 4 roles admin (admin_segurasist/admin_mac/operator/supervisor) viven en
    // el pool admin → login por /v1/auth/login que va contra el pool admin.
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
      if (!body.idToken) {
        throw new Error(`[setup] login para ${role} no devolvió idToken`);
      }
      tokens[role] = body.idToken;
    }

    // El insured vive en el pool insured. /v1/auth/login NO lo encuentra (eso
    // se valida en el `insured pool isolation` describe). Para llenar la matriz
    // pedimos su token directamente al pool insured vía AdminInitiateAuth.
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
    if (!insuredId) {
      throw new Error('[setup] no pude obtener idToken del pool insured');
    }
    tokens.insured = insuredId;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  // -------------------------------------------------------------------------
  // 1) Login + /v1/auth/me devuelve el rol correcto por usuario
  // -------------------------------------------------------------------------
  describe.each(ROLES)('login flow: %s', (role) => {
    it('idToken presente tras login', () => {
      expect(typeof tokens[role]).toBe('string');
      expect((tokens[role] ?? '').length).toBeGreaterThan(20);
    });

    it('GET /v1/auth/me devuelve role + tenant.id consistentes', async () => {
      const res = await request(server).get('/v1/auth/me').set('Authorization', `Bearer ${tokens[role]}`);
      expect(res.status).toBe(200);
      const body = res.body as MeResponseBody;
      expect(body.role).toBe(role);
      // admin_segurasist usa el sentinel `GLOBAL`; el resto un UUID real.
      if (role === 'admin_segurasist') {
        expect(body.tenant.id).toBe('GLOBAL');
      } else {
        expect(body.tenant.id).toMatch(
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
        );
      }
      expect(body.email).toBe(CREDS[role].email);
    });
  });

  // -------------------------------------------------------------------------
  // 2) Endpoint matrix (extraída de los @Roles() reales)
  // -------------------------------------------------------------------------
  interface MatrixEntry {
    method: 'get' | 'post' | 'patch' | 'delete';
    url: string;
    body?: Record<string, unknown>;
    allowed: Role[];
    /** Si el endpoint requiere :id, supertest devuelve 400 (validación zod /
     *  ParseUUIDPipe) en lugar de pasar al guard de roles. Para esos casos
     *  metemos un UUID dummy. */
    note?: string;
  }

  const DUMMY_UUID = '00000000-0000-4000-8000-000000000000';

  const matrix: MatrixEntry[] = [
    // tenants.controller — @Roles('admin_segurasist') a nivel clase
    { method: 'get', url: '/v1/tenants', allowed: ['admin_segurasist'] },
    { method: 'post', url: '/v1/tenants', body: {}, allowed: ['admin_segurasist'] },

    // coverages.controller
    {
      method: 'get',
      url: '/v1/coverages',
      allowed: ['admin_segurasist', 'admin_mac', 'operator', 'supervisor'],
    },
    { method: 'post', url: '/v1/coverages', body: {}, allowed: ['admin_segurasist'] },

    // certificates.controller
    {
      method: 'get',
      url: '/v1/certificates',
      allowed: ['admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured'],
    },
    {
      method: 'post',
      url: `/v1/certificates/${DUMMY_UUID}/reissue`,
      body: {},
      allowed: ['admin_segurasist', 'admin_mac', 'operator'],
    },

    // audit.controller — @Roles a nivel clase
    {
      method: 'get',
      url: '/v1/audit/log',
      allowed: ['admin_segurasist', 'admin_mac', 'supervisor'],
    },

    // chat.controller
    {
      method: 'get',
      url: '/v1/chat/history',
      allowed: ['admin_segurasist', 'admin_mac', 'supervisor', 'insured'],
    },
    {
      method: 'post',
      url: '/v1/chat/kb',
      body: {},
      allowed: ['admin_segurasist'],
    },

    // users.controller — @Roles('admin_mac','admin_segurasist') a nivel clase
    { method: 'get', url: '/v1/users', allowed: ['admin_mac', 'admin_segurasist'] },
    { method: 'post', url: '/v1/users', body: {}, allowed: ['admin_mac', 'admin_segurasist'] },

    // batches.controller
    //
    // NOTA: el controller declara `@Roles('admin_mac','operator','admin_segurasist','supervisor')`
    // PERO también `@Scopes('read:batches')`. Los idTokens emitidos por
    // cognito-local NO contienen el claim `scope` (eso requeriría un Resource
    // Server con scopes definidos vía OAuth client credentials). Por lo tanto
    // el RolesGuard devuelve 403 a TODOS los roles para este endpoint hasta
    // que se mintee un access token con scope. Lo dejamos en `allowed: []`
    // para reflejar el comportamiento real actual.
    {
      method: 'get',
      url: '/v1/batches',
      allowed: [],
    },
  ];

  describe('endpoint matrix', () => {
    matrix.forEach((entry) => {
      describe(`${entry.method.toUpperCase()} ${entry.url}`, () => {
        it.each(ROLES)(
          'as %s',
          async (role) => {
            const token = tokens[role];
            expect(token).toBeDefined();

            const req = (() => {
              switch (entry.method) {
                case 'get':
                  return request(server).get(entry.url);
                case 'post':
                  return request(server)
                    .post(entry.url)
                    .set('Content-Type', 'application/json')
                    .send(entry.body ?? {});
                case 'patch':
                  return request(server)
                    .patch(entry.url)
                    .set('Content-Type', 'application/json')
                    .send(entry.body ?? {});
                case 'delete':
                  return request(server).delete(entry.url);
              }
            })();
            const res = await req.set('Authorization', `Bearer ${token}`);

            if (entry.allowed.includes(role)) {
              // Allowed: NO debe ser 401/403. Aceptamos 200/201/202/204 (ok),
              // 400 (zod en stubs), 404 (resource no existe), 500
              // (NotImplementedException de algunos services Sprint 0).
              expect(res.status).not.toBe(401);
              expect(res.status).not.toBe(403);
            } else {
              // Denied: el RolesGuard devuelve 403 ForbiddenException.
              expect(res.status).toBe(403);
            }
          },
          30_000,
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // 3) Aislamiento del pool insured
  //
  // El insured live en `local_insured`, no en `local_admin`. AuthService.login
  // llama `cognito.loginAdmin()` que apunta SIEMPRE al pool admin
  // (COGNITO_USER_POOL_ID_ADMIN). Por lo tanto un email que solo existe en el
  // pool insured debe fallar con 401 al intentar /v1/auth/login (admin pool no
  // lo encuentra).
  // -------------------------------------------------------------------------
  describe('insured pool isolation', () => {
    it('POST /v1/auth/login con creds del insured → 401 (admin pool no lo conoce)', async () => {
      const res = await request(server)
        .post('/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send({ email: CREDS.insured.email, password: CREDS.insured.password });
      // Importante: el AuthController.login va contra el pool admin. El
      // insured solo tiene cuenta en el pool insured → loginAdmin levanta
      // UserNotFoundException → 401 'Credenciales inválidas'.
      expect(res.status).toBe(401);
    }, 30_000);
  });
});
