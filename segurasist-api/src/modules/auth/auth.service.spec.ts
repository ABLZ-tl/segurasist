import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { ENV_TOKEN } from '@config/config.module';
import type { Env } from '@config/env.schema';
import { CognitoService, type AuthTokens } from '@infra/aws/cognito.service';
import { SesService } from '@infra/aws/ses.service';
import { RedisService } from '@infra/cache/redis.service';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import { EmailTemplateResolver } from '@modules/email/email-template-resolver';
import { NotImplementedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mock, type MockProxy } from 'jest-mock-extended';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let cognito: MockProxy<CognitoService>;

  const tokens: AuthTokens = {
    accessToken: 'access-x',
    refreshToken: 'refresh-x',
    idToken: 'id-x',
    expiresIn: 3600,
  };

  beforeEach(async () => {
    cognito = mock<CognitoService>();
    const env = {
      OTP_TTL_SECONDS: 300,
      OTP_MAX_ATTEMPTS: 5,
      OTP_LOCKOUT_SECONDS: 900,
    } as unknown as Env;
    // RedisService usa `redis.raw.incr/expire/get/set`; mockeamos esos
    // métodos retornando contadores que satisfacen rate-limit checks (1 = primera
    // vez en ventana → permitido).
    // RedisService expone DOS APIs: la wrapper de alto nivel (redis.get/set/del)
    // y el cliente raw ioredis (redis.raw.incr/expire/get/set/...). Ambas se
    // usan en AuthService según el caso (rate limit usa raw para INCR atómico).
    const redisMock = {
      get: jest.fn().mockResolvedValue(null),
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
        { provide: PrismaBypassRlsService, useValue: mock<PrismaBypassRlsService>() },
        { provide: AuditWriterService, useValue: mock<AuditWriterService>() },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('login()', () => {
    it('delega al adminFlow cuando dto trae email/password', async () => {
      cognito.loginAdmin.mockResolvedValue(tokens);
      const result = await service.login({ email: 'a@b.c', password: 'pwd12345' });
      expect(cognito.loginAdmin).toHaveBeenCalledWith('a@b.c', 'pwd12345');
      expect(cognito.loginAdmin).toHaveBeenCalledTimes(1);
      expect(result).toBe(tokens);
    });

    it('lanza NotImplementedException si dto trae curp (insured flow no implementado vía login)', async () => {
      // El union schema permite curp; login debe redirigir a /otp/request.
      await expect(service.login({ curp: 'AAAA000101HDFXYZ01' } as never)).rejects.toThrow(
        NotImplementedException,
      );
      expect(cognito.loginAdmin).not.toHaveBeenCalled();
    });

    it('propaga errores upstream del CognitoService', async () => {
      cognito.loginAdmin.mockRejectedValue(new Error('upstream down'));
      await expect(service.login({ email: 'a@b.c', password: 'pwd12345' })).rejects.toThrow('upstream down');
    });
  });

  // NOTA: tests reales de otpRequest()/otpVerify() pendientes a Sprint 3
  // re-launch de Agente A (el flujo OTP no delega a Cognito sino que tiene
  // lógica propia con Redis + Prisma + SES — requiere mocks específicos
  // y fixtures de insured/email/template que no se construyeron aquí).
  // Cobertura interim: `test/integration/otp-flow.spec.ts` (end-to-end con
  // stack docker + Mailpit).
  describe.skip('otpRequest() / otpVerify() — implementadas, tests pendientes', () => {
    it.todo('cubrir el flow OTP unitariamente');
  });

  describe('refresh()', () => {
    it('delega a cognito.refresh con el refreshToken', async () => {
      cognito.refresh.mockResolvedValue(tokens);
      const result = await service.refresh({ refreshToken: 'rt-' + 'x'.repeat(30) });
      expect(cognito.refresh).toHaveBeenCalledWith('rt-' + 'x'.repeat(30));
      expect(result).toBe(tokens);
    });
  });

  describe('logout()', () => {
    it('llama revoke cuando hay refreshToken', async () => {
      cognito.revoke.mockResolvedValue(undefined);
      await service.logout('rt-abc');
      expect(cognito.revoke).toHaveBeenCalledWith('rt-abc');
    });

    it('NO llama revoke si refreshToken es undefined (logout idempotente)', async () => {
      await service.logout(undefined);
      expect(cognito.revoke).not.toHaveBeenCalled();
    });
  });
});
