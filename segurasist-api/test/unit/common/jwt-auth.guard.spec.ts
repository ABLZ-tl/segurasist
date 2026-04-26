/**
 * JwtAuthGuard — pool-aware validation (H3) + superadmin branch (M2).
 *
 * Mockeamos `jose.jwtVerify` para no necesitar JWKS real. Cada test controla
 * tanto el `payload.aud` (audience) como el issuer al que jose responde.
 *
 * Coverage:
 *   - Token válido pool admin (aud=COGNITO_CLIENT_ID_ADMIN) → user.pool='admin'
 *   - Token válido pool insured (aud=COGNITO_CLIENT_ID_INSURED) → user.pool='insured'
 *   - Token con aud desconocido → 401 AUTH_INVALID_TOKEN
 *   - Privilege escalation: token aud=insured con custom:role=admin_segurasist
 *     → guard pone pool=insured. RolesGuard rechaza por mismatch role/pool.
 *   - token_use=access → 401
 *   - Superadmin: pool=admin + role=admin_segurasist → bypassRls=true,
 *     req.tenant=undefined.
 */
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import type { Env } from '@config/env.schema';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jose from 'jose';
import type * as JoseTypes from 'jose';
import { mockHttpContext } from '../../mocks/execution-context.mock';

jest.mock('jose', () => {
  const actual = jest.requireActual<typeof JoseTypes>('jose');
  return {
    ...actual,
    createRemoteJWKSet: jest.fn(() => 'jwks-stub'),
    jwtVerify: jest.fn(),
  };
});

const jwtVerifyMock = jose.jwtVerify as unknown as jest.MockedFunction<typeof jose.jwtVerify>;

const ADMIN_CLIENT = 'client-admin';
const INSURED_CLIENT = 'client-insured';
const ADMIN_POOL_ID = 'pool-admin';
const INSURED_POOL_ID = 'pool-insured';
const ADMIN_ISSUER = `http://localhost:9229/${ADMIN_POOL_ID}`;
const INSURED_ISSUER = `http://localhost:9229/${INSURED_POOL_ID}`;

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
    TRACE_SAMPLE_RATE: 0,
    DATABASE_URL: 'postgres://x:y@localhost:5432/z',
    REDIS_URL: 'redis://localhost:6379',
    AWS_REGION: 'mx-central-1',
    COGNITO_REGION: 'mx-central-1',
    COGNITO_USER_POOL_ID_ADMIN: ADMIN_POOL_ID,
    COGNITO_USER_POOL_ID_INSURED: INSURED_POOL_ID,
    COGNITO_CLIENT_ID_ADMIN: ADMIN_CLIENT,
    COGNITO_CLIENT_ID_INSURED: INSURED_CLIENT,
    COGNITO_ENDPOINT: 'http://localhost:9229',
    S3_BUCKET_UPLOADS: 'b1',
    S3_BUCKET_CERTIFICATES: 'b2',
    S3_BUCKET_AUDIT: 'b3',
    S3_BUCKET_EXPORTS: 'b4',
    SQS_QUEUE_LAYOUT: 'http://localhost/q1',
    SQS_QUEUE_PDF: 'http://localhost/q2',
    SQS_QUEUE_EMAIL: 'http://localhost/q3',
    SQS_QUEUE_REPORTS: 'http://localhost/q4',
    SES_SENDER_DOMAIN: 'mac.local',
    SES_CONFIGURATION_SET: 'cs',
    KMS_KEY_ID: 'alias/test',
    CORS_ALLOWED_ORIGINS: ['http://localhost'],
    AWS_ENDPOINT_URL: undefined,
    ENABLE_SWAGGER: false,
    ...overrides,
  } as Env;
}

interface VerifyArg {
  issuer: string;
}

/**
 * Helper que respeta el routing pool: el mock de `jwtVerify` devuelve un
 * payload diferente según el issuer pasado en el segundo parámetro
 * (admin vs insured). Si el `aud` no matchea el client del pool, el guard
 * caerá al siguiente intento o lanzará 401.
 */
function mockVerifyByIssuer(byIssuer: Record<string, jose.JWTPayload | Error | undefined>): void {
  jwtVerifyMock.mockImplementation((async (_token: unknown, _key: unknown, opts: VerifyArg) => {
    const result = byIssuer[opts.issuer];
    if (result === undefined) {
      throw new Error(`No mock for issuer ${opts.issuer}`);
    }
    if (result instanceof Error) {
      throw result;
    }
    return { payload: result, protectedHeader: { alg: 'RS256' } };
  }) as never);
}

describe('JwtAuthGuard pool-aware (H3 + M2)', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = new Reflector();
    guard = new JwtAuthGuard(makeEnv(), reflector);
  });

  it('Token válido pool admin (aud=ADMIN_CLIENT, custom:role=admin_mac) → user.pool=admin, user.role=admin_mac', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    mockVerifyByIssuer({
      [ADMIN_ISSUER]: {
        sub: 'u-admin',
        email: 'a@b.c',
        aud: ADMIN_CLIENT,
        token_use: 'id',
        'custom:tenant_id': tenantId,
        'custom:role': 'admin_mac',
        scope: 'read:insureds',
      },
    });

    const req: Record<string, unknown> = { headers: { authorization: 'Bearer abc' } };
    const ctx = mockHttpContext(req);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.user as { role: string; pool?: string }).role).toBe('admin_mac');
    expect((req.user as { role: string; pool?: string }).pool).toBe('admin');
    expect((req.tenant as { id: string }).id).toBe(tenantId);
    expect(req.bypassRls).toBeUndefined();
  });

  it('Token válido pool insured (aud=INSURED_CLIENT, role=insured) → user.pool=insured', async () => {
    const tenantId = '22222222-2222-2222-2222-222222222222';
    // Importante: el guard intenta primero pool admin. Como el token NO matchea
    // el issuer del pool admin (firma del pool insured), jwtVerify de admin
    // falla y caemos al pool insured.
    mockVerifyByIssuer({
      [ADMIN_ISSUER]: new Error('JWS signature verification failed (admin pool)'),
      [INSURED_ISSUER]: {
        sub: 'u-insured',
        aud: INSURED_CLIENT,
        token_use: 'id',
        'custom:tenant_id': tenantId,
        'custom:role': 'insured',
      },
    });

    const req: Record<string, unknown> = { headers: { authorization: 'Bearer xyz' } };
    await expect(guard.canActivate(mockHttpContext(req))).resolves.toBe(true);
    expect((req.user as { pool?: string; role: string }).pool).toBe('insured');
    expect((req.user as { role: string }).role).toBe('insured');
  });

  it('Token con aud desconocido (no matchea ni admin ni insured client) → 401', async () => {
    const tenantId = '33333333-3333-3333-3333-333333333333';
    mockVerifyByIssuer({
      [ADMIN_ISSUER]: {
        sub: 'u',
        aud: 'random-client-not-ours',
        token_use: 'id',
        'custom:tenant_id': tenantId,
        'custom:role': 'admin_mac',
      },
      [INSURED_ISSUER]: new Error('JWS signature verification failed (insured pool)'),
    });

    const ctx = mockHttpContext({ headers: { authorization: 'Bearer x' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(/audience desconocida|AUTH_INVALID_TOKEN/);
  });

  it('PRIVILEGE ESCALATION: token aud=INSURED_CLIENT con custom:role=admin_segurasist → pool=insured (no escala)', async () => {
    const tenantId = '44444444-4444-4444-4444-444444444444';
    // Token firmado por el pool insured (admin pool falla), audience es la del
    // pool insured (lo correcto), pero el atacante manipuló custom:role para
    // pretender ser admin_segurasist. El guard debe poner pool=insured y el
    // RolesGuard debe rechazar por mismatch role/pool.
    mockVerifyByIssuer({
      [ADMIN_ISSUER]: new Error('admin pool: signature failed'),
      [INSURED_ISSUER]: {
        sub: 'attacker',
        aud: INSURED_CLIENT,
        token_use: 'id',
        'custom:tenant_id': tenantId,
        'custom:role': 'admin_segurasist',
      },
    });

    const req: Record<string, unknown> = { headers: { authorization: 'Bearer evil' } };
    await expect(guard.canActivate(mockHttpContext(req))).resolves.toBe(true);
    expect((req.user as { pool?: string; role: string }).pool).toBe('insured');
    // El JwtAuthGuard NO escala al branch superadmin (NO setea bypassRls=true)
    // porque ese branch exige pool=admin.
    expect(req.bypassRls).toBeUndefined();
    expect((req.user as { role: string }).role).toBe('admin_segurasist');
    // El RolesGuard downstream debe rechazar:
    const { RolesGuard } = await import('@common/guards/roles.guard');
    const rg = new RolesGuard(reflector);
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === 'roles') return ['admin_segurasist'];
      return undefined;
    });
    expect(() => rg.canActivate(mockHttpContext(req))).toThrow(ForbiddenException);
    expect(() => rg.canActivate(mockHttpContext(req))).toThrow(/Role\/pool mismatch/);
  });

  it('Token con token_use=access (no id) → 401', async () => {
    const tenantId = '55555555-5555-5555-5555-555555555555';
    mockVerifyByIssuer({
      [ADMIN_ISSUER]: {
        sub: 'u',
        aud: ADMIN_CLIENT,
        token_use: 'access',
        'custom:tenant_id': tenantId,
        'custom:role': 'admin_mac',
      },
    });

    const ctx = mockHttpContext({ headers: { authorization: 'Bearer x' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(/id_token/);
  });

  it('SUPERADMIN: pool=admin + role=admin_segurasist → bypassRls=true, sin tenant context', async () => {
    mockVerifyByIssuer({
      [ADMIN_ISSUER]: {
        sub: 'super-1',
        email: 'superadmin@segurasist.local',
        aud: ADMIN_CLIENT,
        token_use: 'id',
        'custom:role': 'admin_segurasist',
        // sin custom:tenant_id (M2 — el bootstrap ya no lo setea para superadmin).
      },
    });

    const req: Record<string, unknown> = { headers: { authorization: 'Bearer s' } };
    await expect(guard.canActivate(mockHttpContext(req))).resolves.toBe(true);
    expect((req.user as { pool?: string; role: string }).pool).toBe('admin');
    expect((req.user as { role: string }).role).toBe('admin_segurasist');
    expect(req.bypassRls).toBe(true);
    // Importante: NO se setea req.tenant — el superadmin es cross-tenant.
    expect(req.tenant).toBeUndefined();
  });

  it('Superadmin con custom:tenant_id seteado → IGUAL bypassRls (no se filtra a un solo tenant)', async () => {
    mockVerifyByIssuer({
      [ADMIN_ISSUER]: {
        sub: 'super-2',
        aud: ADMIN_CLIENT,
        token_use: 'id',
        'custom:role': 'admin_segurasist',
        'custom:tenant_id': '66666666-6666-6666-6666-666666666666',
      },
    });

    const req: Record<string, unknown> = { headers: { authorization: 'Bearer s' } };
    await expect(guard.canActivate(mockHttpContext(req))).resolves.toBe(true);
    expect(req.bypassRls).toBe(true);
    expect(req.tenant).toBeUndefined();
  });

  it('Token con tenant context faltante para rol no-superadmin → 403', async () => {
    mockVerifyByIssuer({
      [ADMIN_ISSUER]: {
        sub: 'u',
        aud: ADMIN_CLIENT,
        token_use: 'id',
        'custom:role': 'admin_mac',
        // sin custom:tenant_id — el guard rechaza.
      },
    });

    const ctx = mockHttpContext({ headers: { authorization: 'Bearer x' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(/custom:tenant_id/);
  });

  it('Token con aud array (multi-audience) y exactamente 1 entry matcheando admin → ok', async () => {
    const tenantId = '77777777-7777-7777-7777-777777777777';
    mockVerifyByIssuer({
      [ADMIN_ISSUER]: {
        sub: 'u',
        aud: [ADMIN_CLIENT],
        token_use: 'id',
        'custom:tenant_id': tenantId,
        'custom:role': 'admin_mac',
      },
    });

    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    await expect(guard.canActivate(mockHttpContext(req))).resolves.toBe(true);
    expect((req.user as { pool?: string }).pool).toBe('admin');
  });

  it('Token con aud array de >1 elemento → 401 (rechazo defensivo)', async () => {
    const tenantId = '88888888-8888-8888-8888-888888888888';
    mockVerifyByIssuer({
      [ADMIN_ISSUER]: {
        sub: 'u',
        aud: [ADMIN_CLIENT, 'extra-client'],
        token_use: 'id',
        'custom:tenant_id': tenantId,
        'custom:role': 'admin_mac',
      },
      [INSURED_ISSUER]: new Error('insured pool: invalid issuer'),
    });

    const ctx = mockHttpContext({ headers: { authorization: 'Bearer x' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
