import { CurrentUser, type AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { assertPlatformAdmin } from '@common/guards/assert-platform-admin';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Throttle } from '@common/throttler/throttler.decorators';
import { detectFileType } from '@common/utils/file-magic-bytes';
import type { TenantCtx } from '@common/decorators/tenant.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import { BrandingService } from '@modules/tenants/branding/branding.service';
import {
  UpdateBrandingSchema,
  type BrandingResponseDto,
  type UpdateBrandingDto,
} from '@modules/tenants/branding/dto/branding.dto';

/**
 * Sprint 5 — MT-1. Controlador admin para gestión de branding por tenant.
 *
 * Endpoints (todos restringidos a roles admin con assertPlatformAdmin para
 * `admin_segurasist` y `admin_mac` que opera dentro de su tenant):
 *
 *   GET    /v1/admin/tenants/:id/branding
 *   PUT    /v1/admin/tenants/:id/branding
 *   POST   /v1/admin/tenants/:id/branding/logo  (multipart, max 512KB)
 *   DELETE /v1/admin/tenants/:id/branding/logo  (revierte a placeholder)
 *
 * Cross-tenant rules:
 *   - `admin_segurasist` (superadmin) puede operar sobre cualquier tenant.
 *   - `admin_mac` (admin de tenant) sólo puede tocar SU propio tenant —
 *     comparamos `req.tenant.id === :id`. Si no matchea, 403.
 *
 * Audit:
 *   - PUT, POST logo, DELETE logo emiten `tenant_branding_updated` con
 *     `AuditContextFactory.fromRequest(req)` populando ip/ua/traceId.
 *   - GET no se audita (lectura no-mutación; los reads cross-tenant del
 *     superadmin caen bajo el `TenantOverrideAuditInterceptor` global).
 *
 * Throttle 30/60 — operación admin esporádica (cambio de branding ≈ 1/mes
 * por tenant). El cap evita scripts maliciosos que floodearan logo uploads.
 */
@Controller({ path: 'admin/tenants/:id/branding', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_segurasist', 'admin_mac')
export class BrandingAdminController {
  constructor(
    private readonly branding: BrandingService,
    private readonly auditWriter: AuditWriterService,
    private readonly auditCtx: AuditContextFactory,
  ) {}

  @Get()
  @Throttle({ ttl: 60_000, limit: 60 })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
  ): Promise<BrandingResponseDto> {
    this.assertCanOperateOnTenant(user, id, req);
    return this.branding.getBrandingForTenant(id);
  }

  @Put()
  @Throttle({ ttl: 60_000, limit: 30 })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateBrandingSchema)) dto: UpdateBrandingDto,
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
  ): Promise<BrandingResponseDto> {
    this.assertCanOperateOnTenant(user, id, req);
    const updated = await this.branding.updateBranding(id, dto);

    // Audit con ctx HTTP. `tenantId` puesto al tenant target (no `req.tenant.id`
    // del superadmin, que puede ser undefined cross-tenant).
    await this.auditWriter.record({
      ...this.auditCtx.fromRequest(),
      tenantId: id,
      action: 'tenant_branding_updated',
      resourceType: 'tenant.branding',
      resourceId: id,
      payloadDiff: {
        subAction: 'update_metadata',
        // Diff "what changed": nombres de campos (no los valores — los
        // hex/URLs no son secretos pero `displayName` puede contener PII
        // en tenants demo; documentamos campos para forensics sin riesgo).
        fields: ['displayName', 'tagline', 'primaryHex', 'accentHex', 'bgImageUrl'].filter(
          (f) => (dto as Record<string, unknown>)[f] !== undefined,
        ),
      },
    });

    return updated;
  }

  @Post('logo')
  @Throttle({ ttl: 60_000, limit: 10 })
  async uploadLogo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<BrandingResponseDto> {
    this.assertCanOperateOnTenant(user, id, req);

    const file = await (
      req as unknown as {
        file: () => Promise<
          { filename: string; mimetype: string; toBuffer: () => Promise<Buffer> } | undefined
        >;
      }
    ).file();
    if (!file) {
      throw new HttpException('Multipart file requerido', HttpStatus.BAD_REQUEST);
    }
    const buffer = await file.toBuffer();

    // 1) Hard limit 512KB ANTES de file-magic (no parseamos buffers grandes
    // sólo para rechazarlos por tamaño).
    const MAX_BYTES = 512 * 1024;
    if (buffer.length > MAX_BYTES) {
      throw new HttpException(
        {
          message: 'Logo demasiado grande: máximo 512KB.',
          received: buffer.length,
          max: MAX_BYTES,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // 2) Magic-bytes validation. El cliente puede mentir en filename/mimetype
    // (un EXE renombrado .png pasaría sin esto). Aceptamos PNG/SVG/WebP.
    const detected = detectFileType(buffer);
    if (detected !== 'png' && detected !== 'svg' && detected !== 'webp') {
      throw new HttpException(
        {
          message: 'Tipo de imagen no soportado: solo PNG, SVG o WebP.',
          filename: file.filename,
          declaredMime: file.mimetype,
        },
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    const mime: 'image/png' | 'image/svg+xml' | 'image/webp' =
      detected === 'png' ? 'image/png' : detected === 'svg' ? 'image/svg+xml' : 'image/webp';

    const updated = await this.branding.uploadLogo({ tenantId: id, buffer, mime });

    await this.auditWriter.record({
      ...this.auditCtx.fromRequest(),
      tenantId: id,
      action: 'tenant_branding_updated',
      resourceType: 'tenant.branding.logo',
      resourceId: id,
      payloadDiff: {
        subAction: 'logo_uploaded',
        mime,
        sizeBytes: buffer.length,
      },
    });

    return updated;
  }

  @Delete('logo')
  @HttpCode(HttpStatus.OK)
  @Throttle({ ttl: 60_000, limit: 30 })
  async deleteLogo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
  ): Promise<BrandingResponseDto> {
    this.assertCanOperateOnTenant(user, id, req);
    const updated = await this.branding.clearLogo(id);

    await this.auditWriter.record({
      ...this.auditCtx.fromRequest(),
      tenantId: id,
      action: 'tenant_branding_updated',
      resourceType: 'tenant.branding.logo',
      resourceId: id,
      payloadDiff: { subAction: 'logo_cleared' },
    });

    return updated;
  }

  /**
   * `admin_segurasist` (superadmin) puede operar sobre cualquier tenant
   * (assertPlatformAdmin verifica role+pool). `admin_mac` sólo sobre el
   * tenant indicado por su JWT (`req.tenant.id === :id`).
   *
   * Si un `admin_mac` intenta editar el branding de otro tenant → 403.
   * Esto es **el** test cross-tenant que MT-4 va a verificar.
   */
  private assertCanOperateOnTenant(
    user: AuthUser,
    targetTenantId: string,
    req: FastifyRequest,
  ): void {
    if (user.role === 'admin_segurasist') {
      assertPlatformAdmin(user); // H-14 defense-in-depth.
      return;
    }
    // admin_mac (o cualquier admin no-superadmin): debe pertenecer al tenant.
    // Leemos `req.tenant.id` que el `JwtAuthGuard` ya pobló desde el claim
    // `custom:tenant_id` del JWT del admin de tenant. Si por alguna razón
    // viene undefined (admin_mac sin tenant claim, mis-config Cognito) → 403.
    const ctx = (req as unknown as { tenant?: TenantCtx }).tenant;
    if (!ctx?.id || ctx.id !== targetTenantId) {
      throw new HttpException(
        'No autorizado a operar sobre este tenant',
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
