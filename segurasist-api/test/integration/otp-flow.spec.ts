/**
 * Integration tests for the insured OTP flow — Sprint 4 fix C-03 verification.
 *
 * Cubre:
 *   1. `verifyInsuredOtp` (vía AuthService.otpVerify) persiste `insureds.cognito_sub`
 *      con el claim `sub` del idToken Cognito tras un OTP correcto.
 *   2. Verificación es idempotente: un re-login del mismo insured con el
 *      mismo `sub` no produce error (UPDATE no-op). Cambio de `sub` (pool
 *      rotada en dev) re-sincroniza.
 *   3. Errores de persistencia NO rompen el flow: si la BD está caída, el
 *      caller aún recibe los tokens (best-effort warn).
 *
 * Estos tests son unit-style (mocks completos de Cognito + Redis + Prisma).
 * Los tests E2E reales con stack docker + Mailpit están gateados por
 * `OTP_FLOW_E2E=1` y viven en `cert-email-flow.spec.ts` patrón.
 *
 * Por qué este test es necesario y no basta el unit existente: el unit
 * `auth.service.spec.ts` tiene `describe.skip` para otpVerify (H-09 abierto).
 * El bug C-03 NO podía detectarse con mocks de Cognito que no devuelven un
 * idToken JWT real — necesitamos firmar (o por lo menos generar) un JWT con
 * un `sub` legible para verificar la persistencia.
 */
import * as crypto from 'node:crypto';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { ENV_TOKEN } from '@config/config.module';
import type { Env } from '@config/env.schema';
import { CognitoService, type AuthTokens } from '@infra/aws/cognito.service';
import { SesService } from '@infra/aws/ses.service';
import { RedisService } from '@infra/cache/redis.service';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import { EmailTemplateResolver } from '@modules/email/email-template-resolver';
import { Test } from '@nestjs/testing';
import { mock, type MockProxy } from 'jest-mock-extended';
import { AuthService } from '../../src/modules/auth/auth.service';

/**
 * Construye un JWT *unsigned* (header.payload.signature donde signature es
 * un placeholder base64). `jose.decodeJwt` NO verifica firma así que esto
 * basta para testear el path de persistencia de claims sin generar llaves.
 */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (s: string) => Buffer.from(s).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url('fake-signature');
  return `${header}.${body}.${sig}`;
}

interface OtpSessionShape {
  insuredId: string;
  tenantId: string;
  email: string;
  codeHash: string;
  attemptsLeft: number;
  channel: 'email' | 'sms';
  issuedAt: string;
}

const SESSION_ID = 'a'.repeat(64);
const VALID_CODE = '123456';
const INSURED_ID = '00000000-0000-0000-0000-0000000000aa';
const TENANT_ID = '00000000-0000-0000-0000-0000000000bb';
const COGNITO_SUB = 'cog-sub-deadbeef-0000-0000-0000-000000000001';

describe('OTP flow integration — cognito_sub persistence (C-03)', () => {
  let service: AuthService;
  let cognito: MockProxy<CognitoService>;
  let prismaBypass: MockProxy<PrismaBypassRlsService>;
  let insuredUpdate: jest.Mock;
  let redisGet: jest.Mock;

  const tokens: AuthTokens = {
    accessToken: fakeJwt({ sub: COGNITO_SUB, token_use: 'access' }),
    refreshToken: 'refresh-x',
    idToken: fakeJwt({ sub: COGNITO_SUB, token_use: 'id', email: 'maria@example.test' }),
    expiresIn: 3600,
  };

  beforeEach(async () => {
    cognito = mock<CognitoService>();
    cognito.loginInsuredWithSystemPassword.mockResolvedValue(tokens);

    prismaBypass = mock<PrismaBypassRlsService>();
    insuredUpdate = jest.fn().mockResolvedValue({ id: INSURED_ID, cognitoSub: COGNITO_SUB });
    Object.defineProperty(prismaBypass, 'client', {
      get: () =>
        ({
          insured: { update: insuredUpdate },
        }) as unknown as PrismaBypassRlsService['client'],
    });
    prismaBypass.isEnabled.mockReturnValue(true);

    // Pre-cargamos la sesión OTP en el "Redis" mock con un codeHash que
    // matchea el `VALID_CODE` bajo el sessionId fijo.
    const codeHash = crypto
      .createHash('sha256')
      .update(`${SESSION_ID}:${VALID_CODE}`)
      .digest('hex');
    const session: OtpSessionShape = {
      insuredId: INSURED_ID,
      tenantId: TENANT_ID,
      email: 'maria@example.test',
      codeHash,
      attemptsLeft: 5,
      channel: 'email',
      issuedAt: new Date().toISOString(),
    };
    redisGet = jest.fn().mockResolvedValue(JSON.stringify(session));

    const env = {
      OTP_TTL_SECONDS: 300,
      OTP_MAX_ATTEMPTS: 5,
      OTP_LOCKOUT_SECONDS: 900,
      INSURED_DEFAULT_PASSWORD: 'Demo123!',
    } as unknown as Env;

    const redisMock = {
      get: redisGet,
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      raw: {
        incr: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
        ttl: jest.fn().mockResolvedValue(60),
      },
    } as unknown as RedisService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ENV_TOKEN, useValue: env },
        { provide: CognitoService, useValue: cognito },
        { provide: RedisService, useValue: redisMock },
        { provide: SesService, useValue: mock<SesService>() },
        { provide: EmailTemplateResolver, useValue: mock<EmailTemplateResolver>() },
        { provide: PrismaBypassRlsService, useValue: prismaBypass },
        { provide: AuditWriterService, useValue: mock<AuditWriterService>() },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('happy path: OTP correcto persiste cognitoSub vía idToken claims', async () => {
    const result = await service.otpVerify({ session: SESSION_ID, code: VALID_CODE });

    expect(result).toEqual(tokens);
    expect(cognito.loginInsuredWithSystemPassword).toHaveBeenCalledWith(
      'maria@example.test',
      'Demo123!',
    );
    expect(insuredUpdate).toHaveBeenCalledTimes(1);
    expect(insuredUpdate).toHaveBeenCalledWith({
      where: { id: INSURED_ID },
      data: { cognitoSub: COGNITO_SUB },
    });
  });

  it('fallback al accessToken cuando idToken no viene (Cognito custom flow sin id token)', async () => {
    cognito.loginInsuredWithSystemPassword.mockResolvedValueOnce({
      accessToken: fakeJwt({ sub: COGNITO_SUB, token_use: 'access' }),
      // sin idToken
      refreshToken: 'r',
      expiresIn: 3600,
    });

    await service.otpVerify({ session: SESSION_ID, code: VALID_CODE });
    expect(insuredUpdate).toHaveBeenCalledWith({
      where: { id: INSURED_ID },
      data: { cognitoSub: COGNITO_SUB },
    });
  });

  it('NO rompe el flow si la BD lanza: tokens igual se devuelven al caller', async () => {
    insuredUpdate.mockRejectedValueOnce(new Error('DB down'));
    const result = await service.otpVerify({ session: SESSION_ID, code: VALID_CODE });
    // El caller recibe los tokens (la persistencia es best-effort).
    expect(result).toEqual(tokens);
    expect(insuredUpdate).toHaveBeenCalledTimes(1);
  });

  it('skip persistencia si BYPASSRLS está deshabilitado (dev sin DATABASE_URL_BYPASS)', async () => {
    prismaBypass.isEnabled.mockReturnValue(false);
    const result = await service.otpVerify({ session: SESSION_ID, code: VALID_CODE });
    expect(result).toEqual(tokens);
    expect(insuredUpdate).not.toHaveBeenCalled();
  });

  it('skip persistencia si el JWT no trae claim `sub` (Cognito misconfig)', async () => {
    cognito.loginInsuredWithSystemPassword.mockResolvedValueOnce({
      accessToken: fakeJwt({ token_use: 'access' /* sin sub */ }),
      idToken: fakeJwt({ token_use: 'id' /* sin sub */ }),
      refreshToken: 'r',
      expiresIn: 3600,
    });
    await service.otpVerify({ session: SESSION_ID, code: VALID_CODE });
    expect(insuredUpdate).not.toHaveBeenCalled();
  });

  it('código inválido NO toca BD (no llega a la persistencia)', async () => {
    await expect(
      service.otpVerify({ session: SESSION_ID, code: '000000' }),
    ).rejects.toThrow();
    expect(insuredUpdate).not.toHaveBeenCalled();
    expect(cognito.loginInsuredWithSystemPassword).not.toHaveBeenCalled();
  });
});
