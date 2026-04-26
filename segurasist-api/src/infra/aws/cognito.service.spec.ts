import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InvalidPasswordException,
  NotAuthorizedException as CognitoNotAuthorizedException,
  RevokeTokenCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Env } from '@config/env.schema';
import { UnauthorizedException } from '@nestjs/common';
import { CognitoService } from './cognito.service';

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

/**
 * Helper: instala un sendMock sobre el client interno del CognitoService.
 * Evita stubear el constructor del SDK.
 */
function installSendMock(svc: CognitoService): jest.Mock {
  const sendMock = jest.fn();
  // Acceso "interno" para inyectar el mock — los tests son los únicos consumidores.
  const internal = svc as unknown as { client: { send: jest.Mock } };
  internal.client.send = sendMock;
  return sendMock;
}

describe('CognitoService', () => {
  describe('constructor', () => {
    it('respeta COGNITO_ENDPOINT por sobre AWS_ENDPOINT_URL en dev local', () => {
      const svc = new CognitoService(
        makeEnv({ COGNITO_ENDPOINT: 'http://localhost:9229', AWS_ENDPOINT_URL: 'http://localstack:4566' }),
      );
      // El cliente queda construido sin lanzar.
      expect(svc).toBeInstanceOf(CognitoService);
    });

    it('cae en AWS_ENDPOINT_URL si COGNITO_ENDPOINT no está definido', () => {
      const svc = new CognitoService(
        makeEnv({ COGNITO_ENDPOINT: undefined, AWS_ENDPOINT_URL: 'http://localstack:4566' }),
      );
      const client = (svc as unknown as { client: CognitoIdentityProviderClient }).client;
      expect(client).toBeInstanceOf(CognitoIdentityProviderClient);
    });

    it('sin endpoints custom usa AWS prod (sin endpoint override)', () => {
      const svc = new CognitoService(makeEnv({ COGNITO_ENDPOINT: undefined, AWS_ENDPOINT_URL: undefined }));
      expect(svc).toBeInstanceOf(CognitoService);
    });
  });

  describe('loginAdmin()', () => {
    let svc: CognitoService;
    let sendMock: jest.Mock;

    beforeEach(() => {
      svc = new CognitoService(makeEnv());
      sendMock = installSendMock(svc);
    });

    it('despacha AdminInitiateAuthCommand con el payload correcto y devuelve tokens', async () => {
      sendMock.mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'a',
          RefreshToken: 'r',
          IdToken: 'i',
          ExpiresIn: 1234,
        },
      });
      const result = await svc.loginAdmin('a@b.c', 'pwd');
      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0]?.[0] as AdminInitiateAuthCommand;
      expect(cmd).toBeInstanceOf(AdminInitiateAuthCommand);
      expect(cmd.input).toEqual({
        UserPoolId: 'pool-admin',
        ClientId: 'client-admin',
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: 'a@b.c', PASSWORD: 'pwd' },
      });
      expect(result).toEqual({
        accessToken: 'a',
        refreshToken: 'r',
        idToken: 'i',
        expiresIn: 1234,
      });
    });

    it('aplica expiresIn=3600 default si Cognito no lo devuelve', async () => {
      sendMock.mockResolvedValue({ AuthenticationResult: { AccessToken: 'a' } });
      const r = await svc.loginAdmin('a@b.c', 'p');
      expect(r.expiresIn).toBe(3600);
    });

    it('lanza UnauthorizedException si la respuesta no trae AuthenticationResult.AccessToken', async () => {
      sendMock.mockResolvedValue({});
      await expect(svc.loginAdmin('a@b.c', 'p')).rejects.toThrow(UnauthorizedException);
      sendMock.mockResolvedValue({ AuthenticationResult: {} });
      await expect(svc.loginAdmin('a@b.c', 'p')).rejects.toThrow(UnauthorizedException);
    });

    it.each([
      [
        'NotAuthorizedException',
        new CognitoNotAuthorizedException({
          message: 'Incorrect username or password.',
          $metadata: {},
        }),
      ],
      [
        'UserNotFoundException',
        new UserNotFoundException({ message: 'User does not exist.', $metadata: {} }),
      ],
      [
        'InvalidPasswordException',
        new InvalidPasswordException({ message: 'invalid password', $metadata: {} }),
      ],
    ])('mapea %s a UnauthorizedException con mensaje genérico (no enumeración)', async (_label, sdkErr) => {
      sendMock.mockRejectedValue(sdkErr);
      try {
        await svc.loginAdmin('a@b.c', 'p');
        fail('expected UnauthorizedException');
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException);
        const msg = (err as Error).message.toLowerCase();
        // No debe filtrar info del backing store.
        expect(msg).toContain('credenciales inválidas');
        expect(msg).not.toContain('user does not exist');
      }
    });

    it('re-lanza errores SDK desconocidos sin envolverlos', async () => {
      const upstream = new Error('throttled');
      sendMock.mockRejectedValue(upstream);
      await expect(svc.loginAdmin('a@b.c', 'p')).rejects.toBe(upstream);
    });
  });

  describe('refresh()', () => {
    let svc: CognitoService;
    let sendMock: jest.Mock;

    beforeEach(() => {
      svc = new CognitoService(makeEnv());
      sendMock = installSendMock(svc);
    });

    it('despacha InitiateAuthCommand con REFRESH_TOKEN_AUTH', async () => {
      sendMock.mockResolvedValue({
        AuthenticationResult: { AccessToken: 'a', IdToken: 'i', RefreshToken: 'r2', ExpiresIn: 100 },
      });
      const r = await svc.refresh('rt');
      const cmd = sendMock.mock.calls[0]?.[0] as InitiateAuthCommand;
      expect(cmd).toBeInstanceOf(InitiateAuthCommand);
      expect(cmd.input).toEqual({
        ClientId: 'client-admin',
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: 'rt' },
      });
      expect(r.refreshToken).toBe('r2');
      expect(r.accessToken).toBe('a');
      expect(r.expiresIn).toBe(100);
    });

    it('reusa el refreshToken original si Cognito no devuelve uno nuevo', async () => {
      sendMock.mockResolvedValue({ AuthenticationResult: { AccessToken: 'a' } });
      const r = await svc.refresh('original-rt');
      expect(r.refreshToken).toBe('original-rt');
      expect(r.expiresIn).toBe(3600);
    });

    it('lanza UnauthorizedException si Cognito responde sin AccessToken', async () => {
      sendMock.mockResolvedValue({ AuthenticationResult: {} });
      await expect(svc.refresh('rt')).rejects.toThrow(UnauthorizedException);
    });

    it('mapea NotAuthorizedException a UnauthorizedException("Refresh token inválido")', async () => {
      sendMock.mockRejectedValue(
        new CognitoNotAuthorizedException({ message: 'Invalid Refresh Token', $metadata: {} }),
      );
      await expect(svc.refresh('rt')).rejects.toThrow(/Refresh token inválido/);
    });

    it('re-lanza errores SDK desconocidos sin envolver', async () => {
      const e = new Error('5xx aws');
      sendMock.mockRejectedValue(e);
      await expect(svc.refresh('rt')).rejects.toBe(e);
    });
  });

  describe('revoke()', () => {
    it('despacha RevokeTokenCommand con ClientId y Token', async () => {
      const svc = new CognitoService(makeEnv());
      const sendMock = installSendMock(svc);
      sendMock.mockResolvedValue({});
      await svc.revoke('rt-x');
      const cmd = sendMock.mock.calls[0]?.[0] as RevokeTokenCommand;
      expect(cmd).toBeInstanceOf(RevokeTokenCommand);
      expect(cmd.input).toEqual({ ClientId: 'client-admin', Token: 'rt-x' });
    });

    it('SWALLOW: si revoke falla upstream NO propaga (cognito-local puede no implementarlo)', async () => {
      const svc = new CognitoService(makeEnv());
      const sendMock = installSendMock(svc);
      sendMock.mockRejectedValue(new Error('not implemented'));
      await expect(svc.revoke('rt-x')).resolves.toBeUndefined();
    });
  });

  describe('startInsuredOtp() / verifyInsuredOtp() — Sprint 0 stubs', () => {
    it('startInsuredOtp lanza NotImplementedException', async () => {
      const svc = new CognitoService(makeEnv());
      await expect(svc.startInsuredOtp('CURP', 'email')).rejects.toThrow('startInsuredOtp');
    });
    it('verifyInsuredOtp lanza NotImplementedException', async () => {
      const svc = new CognitoService(makeEnv());
      await expect(svc.verifyInsuredOtp('s', '123456')).rejects.toThrow('verifyInsuredOtp');
    });
  });
});
