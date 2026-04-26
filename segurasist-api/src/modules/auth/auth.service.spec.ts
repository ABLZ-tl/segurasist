import { CognitoService, type AuthTokens } from '@infra/aws/cognito.service';
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
    const moduleRef = await Test.createTestingModule({
      providers: [AuthService, { provide: CognitoService, useValue: cognito }],
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

  describe('otpRequest()', () => {
    it('delega a startInsuredOtp con curp y channel', async () => {
      cognito.startInsuredOtp.mockResolvedValue({ session: 'sess-1' });
      const result = await service.otpRequest({ curp: 'AAAA000101HDFXYZ01', channel: 'email' });
      expect(cognito.startInsuredOtp).toHaveBeenCalledWith('AAAA000101HDFXYZ01', 'email');
      expect(result).toEqual({ session: 'sess-1' });
    });
  });

  describe('otpVerify()', () => {
    it('delega a verifyInsuredOtp con session y code', async () => {
      cognito.verifyInsuredOtp.mockResolvedValue(tokens);
      const result = await service.otpVerify({ session: 'sess-12345', code: '123456' });
      expect(cognito.verifyInsuredOtp).toHaveBeenCalledWith('sess-12345', '123456');
      expect(result).toBe(tokens);
    });
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
