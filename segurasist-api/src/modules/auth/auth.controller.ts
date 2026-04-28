import { CurrentUser, AuthUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/roles.decorator';
import { TenantCtx } from '@common/decorators/tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { TenantThrottle, Throttle } from '@common/throttler/throttler.decorators';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
import { Body, Controller, HttpCode, HttpStatus, Post, Get, Req, UseGuards, UsePipes } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
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
  constructor(
    private readonly auth: AuthService,
    private readonly auditCtx: AuditContextFactory,
  ) {}

  @Public()
  // Anti bruteforce: 5 logins por minuto por (ip+ruta).
  @Throttle({ ttl: 60_000, limit: 5 })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(LoginSchema))
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  // Anti bombing de SMS/email OTP per-IP.
  @Throttle({ ttl: 60_000, limit: 5 })
  // S3-10 — anti CURP-spray cross-tenant. Hoy la ruta es `@Public` y no
  // tiene `req.tenant`, así que este decorator es NO-OP en runtime — el
  // bucket tenant requiere `req.tenant` poblado por JwtAuthGuard. Se deja
  // declarativamente para forward-compat: cuando S5 introduzca resolución
  // de tenant pre-auth (subdomain o tenant-hint en payload), el guard
  // empezará a aplicar este cap automáticamente sin tocar el controller.
  // El cap real per-CURP hoy vive en `AuthService.checkCurpRateLimit` (5/min).
  @TenantThrottle({ ttl: 60_000, limit: 50 })
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(OtpRequestSchema))
  otpRequest(@Body() dto: OtpRequestDto) {
    // F6 iter 2 H-01 — propaga {ip, userAgent, traceId} canónicos al service
    // via AuditContextFactory.fromRequest(). Sustituye el shape ad-hoc previo
    // (donde el row de audit `otp_requested` carecía de IP/UA/traceId).
    return this.auth.otpRequest(dto, this.auditCtx.fromRequest());
  }

  @Public()
  // Anti bruteforce de códigos OTP de 6 dígitos.
  @Throttle({ ttl: 60_000, limit: 5 })
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(OtpVerifySchema))
  otpVerify(@Body() dto: OtpVerifyDto) {
    // F6 iter 2 H-01 — ver comentario en otpRequest.
    return this.auth.otpVerify(dto, this.auditCtx.fromRequest());
  }

  @Public()
  // H-08 — Anti brute-force de refresh tokens. Sin cap, un atacante con un
  // refresh válido (filtrado por XSS o SSRF) podría rotar tokens indefinidamente
  // y los tokens viejos quedarían en el grace period (revoke list lazy). Cap
  // 10/min/IP es ~3x el budget legítimo de un cliente con silent-refresh
  // agresivo (cada 10s ⇒ 6/min). Mantiene `Throttle` consistente con `/login`.
  @Throttle({ ttl: 60_000, limit: 10 })
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
  me(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest & { tenant?: TenantCtx }) {
    // Superadmin: no tiene `req.tenant` (cross-tenant). El resto sí.
    // Usamos @Req en vez de @Tenant para no fallar con el throw del decorator.
    const tenant = req.tenant;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      scopes: user.scopes,
      mfa: user.mfaEnrolled,
      tenant: tenant ?? null,
      tenantId: tenant?.id ?? null,
      pool: user.pool ?? null,
    };
  }
}
