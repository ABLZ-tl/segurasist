import type { Env } from '@config/env.schema';
import { ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jose from 'jose';
import type * as JoseTypes from 'jose';
import { mockHttpContext } from '../../../test/mocks/execution-context.mock';
import { PUBLIC_KEY } from '../decorators/roles.decorator';
import { JwtAuthGuard, resolveMfaEnforcement, type MfaEnforcement } from './jwt-auth.guard';

jest.mock('jose', () => {
  const actual = jest.requireActual<typeof JoseTypes>('jose');
  return {
    ...actual,
    createRemoteJWKSet: jest.fn(() => 'jwks-stub'),
    jwtVerify: jest.fn(),
  };
});

const jwtVerifyMock = jose.jwtVerify as unknown as jest.MockedFunction<typeof jose.jwtVerify>;
const createRemoteJWKSetMock = jose.createRemoteJWKSet as unknown as jest.MockedFunction<
  typeof jose.createRemoteJWKSet
>;

const ADMIN_CLIENT = 'client-admin';
const INSURED_CLIENT = 'client-insured';

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
    COGNITO_USER_POOL_ID_ADMIN: 'pool-admin',
    COGNITO_USER_POOL_ID_INSURED: 'pool-insured',
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

describe('JwtAuthGuard (basics)', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = new Reflector();
    guard = new JwtAuthGuard(makeEnv(), reflector);
  });

  it('construye el issuer con COGNITO_ENDPOINT cuando está presente (dev local)', () => {
    new JwtAuthGuard(makeEnv({ COGNITO_ENDPOINT: 'http://localhost:9229/' }), reflector);
    // El primer arg de createRemoteJWKSet es la URL JWKS — debe partir del endpoint custom.
    const calls = createRemoteJWKSetMock.mock.calls;
    const urls = calls.map((c) => c[0].toString());
    expect(urls.some((u) => u.startsWith('http://localhost:9229/pool-admin/.well-known/jwks.json'))).toBe(
      true,
    );
    expect(urls.some((u) => u.startsWith('http://localhost:9229/pool-insured/.well-known/jwks.json'))).toBe(
      true,
    );
  });

  it('construye el issuer prod (cognito-idp.<region>.amazonaws.com) cuando COGNITO_ENDPOINT está ausente', () => {
    createRemoteJWKSetMock.mockClear();
    new JwtAuthGuard(makeEnv({ COGNITO_ENDPOINT: undefined, COGNITO_REGION: 'us-east-1' }), reflector);
    const urls = createRemoteJWKSetMock.mock.calls.map((c) => c[0].toString());
    expect(urls[0]).toBe('https://cognito-idp.us-east-1.amazonaws.com/pool-admin/.well-known/jwks.json');
    expect(urls[1]).toBe('https://cognito-idp.us-east-1.amazonaws.com/pool-insured/.well-known/jwks.json');
  });

  it('permite el request sin autenticación cuando el endpoint está marcado @Public()', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => key === PUBLIC_KEY);
    const ctx = mockHttpContext({ headers: {} });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('lanza UnauthorizedException si no hay header Authorization', async () => {
    const ctx = mockHttpContext({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Missing bearer token');
  });

  it('lanza UnauthorizedException si el header no empieza con Bearer', async () => {
    const ctx = mockHttpContext({ headers: { authorization: 'Basic abc' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('lanza UnauthorizedException si el header es de tipo no-string (array)', async () => {
    const ctx = mockHttpContext({ headers: { authorization: ['Bearer x'] as unknown as string } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('valida contra el pool admin (aud=admin) y popula req.user / req.tenant con pool=admin', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    jwtVerifyMock.mockResolvedValueOnce({
      payload: {
        sub: 'user-1',
        email: 'a@b.c',
        aud: ADMIN_CLIENT,
        token_use: 'id',
        'custom:tenant_id': tenantId,
        'custom:role': 'admin_mac',
        scope: 'read:insureds write:insureds',
      },
      protectedHeader: { alg: 'RS256' },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const req: Record<string, unknown> = { headers: { authorization: 'Bearer abc.def.ghi' } };
    const ctx = mockHttpContext(req);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({
      id: 'user-1',
      cognitoSub: 'user-1',
      email: 'a@b.c',
      role: 'admin_mac',
      scopes: ['read:insureds', 'write:insureds'],
      mfaEnrolled: true,
      mfaVerified: false,
      pool: 'admin',
    });
    expect(req.tenant).toEqual({ id: tenantId });
  });

  it('hace fallback al pool insured si el pool admin falla', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    jwtVerifyMock.mockRejectedValueOnce(new Error('admin pool: invalid issuer')).mockResolvedValueOnce({
      payload: {
        sub: 'insured-1',
        aud: INSURED_CLIENT,
        token_use: 'id',
        'custom:tenant_id': tenantId,
      },
      protectedHeader: { alg: 'RS256' },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const req: Record<string, unknown> = { headers: { authorization: 'Bearer xyz' } };
    const ctx = mockHttpContext(req);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.user as { role: string; pool?: string }).role).toBe('insured');
    expect((req.user as { pool?: string }).pool).toBe('insured');
  });

  it('lanza UnauthorizedException si el token falla en ambos pools', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('JWS signature verification failed'));
    const ctx = mockHttpContext({ headers: { authorization: 'Bearer bad' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(/Invalid token/);
  });

  it('lanza ForbiddenException si el token NO trae custom:tenant_id (rol no-superadmin)', async () => {
    // mockResolvedValue (no Once) porque el assert hace dos invocaciones.
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-1', aud: ADMIN_CLIENT, token_use: 'id', 'custom:role': 'admin_mac' },
      protectedHeader: { alg: 'RS256' },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);
    const ctx = mockHttpContext({ headers: { authorization: 'Bearer x' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('custom:tenant_id');
  });

  it('default role=insured y scopes=[] cuando claims no los traen', async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: {
        sub: 'u',
        aud: INSURED_CLIENT,
        token_use: 'id',
        'custom:tenant_id': '22222222-2222-2222-2222-222222222222',
      },
      protectedHeader: { alg: 'RS256' },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const req: Record<string, unknown> = { headers: { authorization: 'Bearer t' } };
    await guard.canActivate(mockHttpContext(req));
    expect((req.user as { role: string; scopes: string[] }).role).toBe('insured');
    expect((req.user as { role: string; scopes: string[] }).scopes).toEqual([]);
  });
});

describe('resolveMfaEnforcement', () => {
  it('respeta el override explícito independientemente del NODE_ENV', () => {
    expect(resolveMfaEnforcement({ NODE_ENV: 'production', MFA_ENFORCEMENT: 'log' })).toBe('log');
    expect(resolveMfaEnforcement({ NODE_ENV: 'development', MFA_ENFORCEMENT: 'strict' })).toBe('strict');
    expect(resolveMfaEnforcement({ NODE_ENV: 'test', MFA_ENFORCEMENT: 'off' })).toBe('off');
  });
  it('default = strict en production', () => {
    expect(resolveMfaEnforcement({ NODE_ENV: 'production', MFA_ENFORCEMENT: undefined })).toBe('strict');
  });
  it('default = log en development/test/staging', () => {
    expect(resolveMfaEnforcement({ NODE_ENV: 'development', MFA_ENFORCEMENT: undefined })).toBe('log');
    expect(resolveMfaEnforcement({ NODE_ENV: 'test', MFA_ENFORCEMENT: undefined })).toBe('log');
    expect(resolveMfaEnforcement({ NODE_ENV: 'staging', MFA_ENFORCEMENT: undefined })).toBe('log');
  });
});

describe('JwtAuthGuard MFA enforcement', () => {
  const TENANT = '11111111-1111-1111-1111-111111111111';
  let reflector: Reflector;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = new Reflector();
    // Silenciar el warn del guard init (off mode) y capturarlo donde haga falta.
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function buildGuard(mode: MfaEnforcement | undefined): JwtAuthGuard {
    return new JwtAuthGuard(makeEnv({ MFA_ENFORCEMENT: mode }), reflector);
  }

  function adminClaims(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      sub: 'admin-1',
      email: 'admin@mac.local',
      aud: ADMIN_CLIENT,
      token_use: 'id',
      'custom:tenant_id': TENANT,
      'custom:role': 'admin_mac',
      ...extra,
    };
  }

  function mockClaims(claims: Record<string, unknown>): void {
    jwtVerifyMock.mockResolvedValue({
      payload: claims,
      protectedHeader: { alg: 'RS256' },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);
  }

  it("strict + admin sin amr → 403 'MFA required for admin role'", async () => {
    const guard = buildGuard('strict');
    mockClaims(adminClaims());
    const ctx = mockHttpContext({ headers: { authorization: 'Bearer x' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('MFA required for admin role');
  });

  it("strict + admin con amr=['mfa'] → 200, mfaVerified=true", async () => {
    const guard = buildGuard('strict');
    mockClaims(adminClaims({ amr: ['pwd', 'mfa'] }));
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    await expect(guard.canActivate(mockHttpContext(req))).resolves.toBe(true);
    expect((req.user as { mfaVerified?: boolean }).mfaVerified).toBe(true);
  });

  it('strict + admin con cognito:mfa_enabled=true → 200, mfaVerified=true (alternativa)', async () => {
    const guard = buildGuard('strict');
    mockClaims(adminClaims({ 'cognito:mfa_enabled': true }));
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    await expect(guard.canActivate(mockHttpContext(req))).resolves.toBe(true);
    expect((req.user as { mfaVerified?: boolean }).mfaVerified).toBe(true);
  });

  it("log + admin sin amr → 200 + warning logged 'admin sin amr=mfa'", async () => {
    const guard = buildGuard('log');
    mockClaims(adminClaims());
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    await expect(guard.canActivate(mockHttpContext(req))).resolves.toBe(true);
    expect((req.user as { mfaVerified?: boolean }).mfaVerified).toBe(false);
    // Cualquier warn con 'admin sin amr=mfa' es suficiente.
    const matched = warnSpy.mock.calls.some((call: unknown[]) =>
      call.some((arg: unknown) => typeof arg === 'string' && arg.includes('admin sin amr=mfa')),
    );
    expect(matched).toBe(true);
  });

  it('off + admin sin amr → 200 sin warning de enforcement (init log es separado)', async () => {
    const guard = buildGuard('off');
    // El constructor ya emitió un warn `MFA_ENFORCEMENT=off`. Limpiamos para
    // sólo inspeccionar warns de canActivate.
    warnSpy.mockClear();
    mockClaims(adminClaims());
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    await expect(guard.canActivate(mockHttpContext(req))).resolves.toBe(true);
    expect((req.user as { mfaVerified?: boolean }).mfaVerified).toBe(false);
    const matched = warnSpy.mock.calls.some((call: unknown[]) =>
      call.some(
        (arg: unknown) =>
          typeof arg === 'string' && (arg.includes('admin sin amr=mfa') || arg.includes('MFA missing')),
      ),
    );
    expect(matched).toBe(false);
  });

  it('strict + operator sin amr → 200, sin warning, sin rechazo (operator no MFA-required)', async () => {
    const guard = buildGuard('strict');
    mockClaims(adminClaims({ 'custom:role': 'operator' }));
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    warnSpy.mockClear();
    await expect(guard.canActivate(mockHttpContext(req))).resolves.toBe(true);
    expect((req.user as { role: string }).role).toBe('operator');
    const matched = warnSpy.mock.calls.some((call: unknown[]) =>
      call.some(
        (arg: unknown) =>
          typeof arg === 'string' && (arg.includes('admin sin amr=mfa') || arg.includes('MFA missing')),
      ),
    );
    expect(matched).toBe(false);
  });

  it('strict + insured sin amr → 200 (todos los modos no aplican)', async () => {
    for (const mode of ['strict', 'log', 'off'] as const) {
      const guard = buildGuard(mode);
      jwtVerifyMock.mockResolvedValueOnce({
        payload: {
          sub: 'insured-1',
          aud: INSURED_CLIENT,
          token_use: 'id',
          'custom:tenant_id': TENANT,
          'custom:role': 'insured',
        },
        protectedHeader: { alg: 'RS256' },
      } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);
      const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
      await expect(guard.canActivate(mockHttpContext(req))).resolves.toBe(true);
      expect((req.user as { role: string }).role).toBe('insured');
    }
  });

  it("strict + admin_segurasist sin amr (pool=admin) → 403 'MFA required'", async () => {
    const guard = buildGuard('strict');
    // Superadmin no necesita custom:tenant_id.
    mockClaims({
      sub: 'super-1',
      email: 'super@segurasist.local',
      aud: ADMIN_CLIENT,
      token_use: 'id',
      'custom:role': 'admin_segurasist',
    });
    const ctx = mockHttpContext({ headers: { authorization: 'Bearer x' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow('MFA required for admin role');
  });
});
