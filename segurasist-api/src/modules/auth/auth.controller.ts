import { CurrentUser, AuthUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/roles.decorator';
import { Tenant, TenantCtx } from '@common/decorators/tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Body, Controller, HttpCode, HttpStatus, Post, Get, UseGuards, UsePipes } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  LoginSchema,
  OtpRequestSchema,
  OtpVerifySchema,
  RefreshSchema,
  type LoginDto,
  type OtpRequestDto,
  type OtpVerifyDto,
  type RefreshDto,
} from './dto/auth.dto';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(LoginSchema))
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(OtpRequestSchema))
  otpRequest(@Body() dto: OtpRequestDto) {
    return this.auth.otpRequest(dto);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(OtpVerifySchema))
  otpVerify(@Body() dto: OtpVerifyDto) {
    return this.auth.otpVerify(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(RefreshSchema))
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body('refreshToken') refreshToken?: string): Promise<void> {
    await this.auth.logout(refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUser, @Tenant() tenant: TenantCtx) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      scopes: user.scopes,
      mfa: user.mfaEnrolled,
      tenant,
    };
  }
}
