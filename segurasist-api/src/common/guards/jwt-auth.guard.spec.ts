import type { Env } from '@config/env.schema';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jose from 'jose';
import type * as JoseTypes from 'jose';
import { mockHttpContext } from '../../../test/mocks/execution-context.mock';
import { PUBLIC_KEY } from '../decorators/roles.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

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
    COGNITO_CLIENT_ID_ADMIN: 'client-admin',
    COGNITO_CLIENT_ID_INSURED: 'client-insured',
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

describe('JwtAuthGuard', () => {
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

  it('valida contra el pool admin y popula req.user / req.tenant', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    jwtVerifyMock.mockResolvedValueOnce({
      payload: {
        sub: 'user-1',
        email: 'a@b.c',
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
    });
    expect(req.tenant).toEqual({ id: tenantId });
  });

  it('hace fallback al pool insured si el pool admin falla', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    jwtVerifyMock.mockRejectedValueOnce(new Error('admin pool: invalid issuer')).mockResolvedValueOnce({
      payload: {
        sub: 'insured-1',
        'custom:tenant_id': tenantId,
      },
      protectedHeader: { alg: 'RS256' },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const req: Record<string, unknown> = { headers: { authorization: 'Bearer xyz' } };
    const ctx = mockHttpContext(req);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.user as { role: string }).role).toBe('insured');
  });

  it('lanza UnauthorizedException si el token falla en ambos pools', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('JWS signature verification failed'));
    const ctx = mockHttpContext({ headers: { authorization: 'Bearer bad' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(/Invalid token/);
  });

  it('lanza ForbiddenException si el token NO trae custom:tenant_id', async () => {
    // mockResolvedValue (no Once) porque el assert hace dos invocaciones.
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-1' },
      protectedHeader: { alg: 'RS256' },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);
    const ctx = mockHttpContext({ headers: { authorization: 'Bearer x' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('custom:tenant_id');
  });

  it('default role=insured y scopes=[] cuando claims no los traen', async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { sub: 'u', 'custom:tenant_id': '22222222-2222-2222-2222-222222222222' },
      protectedHeader: { alg: 'RS256' },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const req: Record<string, unknown> = { headers: { authorization: 'Bearer t' } };
    await guard.canActivate(mockHttpContext(req));
    expect((req.user as { role: string; scopes: string[] }).role).toBe('insured');
    expect((req.user as { role: string; scopes: string[] }).scopes).toEqual([]);
  });
});
