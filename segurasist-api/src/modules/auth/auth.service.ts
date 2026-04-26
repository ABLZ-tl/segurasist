import { CognitoService, AuthTokens } from '@infra/aws/cognito.service';
import { Injectable, NotImplementedException } from '@nestjs/common';
import { LoginDto, OtpRequestDto, OtpVerifyDto, RefreshDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(private readonly cognito: CognitoService) {}

  async login(dto: LoginDto): Promise<AuthTokens> {
    if ('email' in dto) {
      return this.cognito.loginAdmin(dto.email, dto.password);
    }
    throw new NotImplementedException('AuthService.login (curp flow) — use /otp/request');
  }

  async otpRequest(dto: OtpRequestDto): Promise<{ session: string }> {
    return this.cognito.startInsuredOtp(dto.curp, dto.channel);
  }

  async otpVerify(dto: OtpVerifyDto): Promise<AuthTokens> {
    return this.cognito.verifyInsuredOtp(dto.session, dto.code);
  }

  async refresh(dto: RefreshDto): Promise<AuthTokens> {
    return this.cognito.refresh(dto.refreshToken);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.cognito.revoke(refreshToken);
    }
  }
}
