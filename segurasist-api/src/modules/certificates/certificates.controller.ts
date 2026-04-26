import { CurrentUser, AuthUser } from '@common/decorators/current-user.decorator';
import { Public, Roles } from '@common/decorators/roles.decorator';
import { Tenant, TenantCtx } from '@common/decorators/tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Throttle } from '@common/throttler/throttler.decorators';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CertificatesService } from './certificates.service';
import {
  ListCertificatesQuerySchema,
  ListEmailEventsQuerySchema,
  ReissueCertificateSchema,
  ResendEmailSchema,
  type ListCertificatesQuery,
  type ListEmailEventsQuery,
  type ReissueCertificateDto,
  type ResendEmailDto,
} from './dto/certificate.dto';

@Controller({ path: 'certificates', version: '1' })
export class CertificatesController {
  constructor(private readonly certs: CertificatesService) {}

  /**
   * Verificación pública por hash. NO requiere auth (es lo que el QR del
   * cert apunta para que terceros validen). Rate limit estricto: 60/min/IP.
   *
   * IMPORTANTE: este handler está DEFINIDO ANTES de cualquier `@UseGuards`
   * a nivel controller — Nest aplica los guards declarados con @UseGuards
   * en el handler/clase. Como aquí no usamos guards y el decorator @Public
   * lo confirma para el JwtAuthGuard global (si aplicara), queda accesible.
   */
  @Get('verify/:hash')
  @Public()
  @Throttle({ ttl: 60_000, limit: 60 })
  verify(@Param('hash') hash: string): Promise<unknown> {
    return this.certs.verify(hash);
  }

  /**
   * Endpoints autenticados. Todos requieren tenant context (excepto
   * verify arriba). El insured solo ve los suyos (filter en service).
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured')
  list(
    @Query(new ZodValidationPipe(ListCertificatesQuerySchema)) q: ListCertificatesQuery,
    @Tenant() tenant: TenantCtx,
    @CurrentUser() user: AuthUser,
  ) {
    return this.certs.list(q, tenant, user);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Tenant() tenant: TenantCtx,
    @CurrentUser() user: AuthUser,
  ) {
    return this.certs.findOne(id, tenant, user);
  }

  @Get(':id/url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured')
  presignedUrl(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Tenant() tenant: TenantCtx,
    @CurrentUser() user: AuthUser,
  ) {
    return this.certs.presignedUrl(id, tenant, user);
  }

  @Post(':id/reissue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin_segurasist', 'admin_mac', 'operator')
  reissue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ReissueCertificateSchema)) dto: ReissueCertificateDto,
    @Tenant() tenant: TenantCtx,
  ) {
    return this.certs.reissue(id, dto, tenant);
  }

  @Post(':id/resend-email')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin_segurasist', 'admin_mac', 'operator')
  resendEmail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ResendEmailSchema)) dto: ResendEmailDto,
    @Tenant() tenant: TenantCtx,
  ) {
    return this.certs.resendEmail(id, dto, tenant);
  }

  @Get(':id/email-events')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  emailEvents(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(ListEmailEventsQuerySchema)) q: ListEmailEventsQuery,
    @Tenant() tenant: TenantCtx,
    @CurrentUser() user: AuthUser,
  ) {
    return this.certs.listEmailEvents(id, q, tenant, user);
  }
}
