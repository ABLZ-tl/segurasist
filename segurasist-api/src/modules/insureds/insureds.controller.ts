import { CurrentUser, type AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { Tenant, TenantCtx } from '@common/decorators/tenant.decorator';
import { assertPlatformAdmin } from '@common/guards/assert-platform-admin';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Throttle } from '@common/throttler/throttler.decorators';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
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
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ExportRequestSchema, type ExportRequestDto } from './dto/export.dto';
import {
  CreateInsuredSchema,
  ListInsuredsQuerySchema,
  UpdateInsuredSchema,
  type CreateInsuredDto,
  type ListInsuredsQuery,
  type UpdateInsuredDto,
} from './dto/insured.dto';
import { ExportRateLimitGuard } from './export-rate-limit.guard';
import { InsuredsService, type InsuredsScope } from './insureds.service';

@Controller({ path: 'insureds', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class InsuredsController {
  constructor(
    private readonly insureds: InsuredsService,
    private readonly auditCtx: AuditContextFactory,
  ) {}

  /**
   * M2 — extrae el scope (platformAdmin + tenantId) leyendo `req.user`
   * (lo pobló `JwtAuthGuard`). Para superadmin: `tenantId` viene del query
   * (opcional). Para roles tenant-scoped: `tenantId` viene del JWT vía
   * `req.tenant` y el query param se ignora silenciosamente (RLS lo enforza).
   */
  private buildScope(
    req: FastifyRequest & { user?: AuthUser; tenant?: TenantCtx },
    queryTenantId: string | undefined,
  ): InsuredsScope {
    const platformAdmin = req.user?.platformAdmin === true;
    if (platformAdmin) {
      // H-14 — runtime defense-in-depth: si el flag platformAdmin viene en true,
      // el service usará PrismaBypassRlsService (BYPASSRLS, cross-tenant). Validamos
      // que el role del JWT sea admin_segurasist antes de permitirlo.
      assertPlatformAdmin(req.user);
    }
    return {
      platformAdmin,
      tenantId: platformAdmin ? queryTenantId : req.tenant?.id,
      actorId: req.user?.id,
    };
  }

  @Get()
  @Roles('admin_mac', 'operator', 'admin_segurasist', 'supervisor')
  list(
    @Query(new ZodValidationPipe(ListInsuredsQuerySchema)) q: ListInsuredsQuery,
    @Req() req: FastifyRequest & { user?: AuthUser; tenant?: TenantCtx },
  ) {
    return this.insureds.list(q, this.buildScope(req, q.tenantId));
  }

  /**
   * Portal asegurado — datos del propio asegurado autenticado.
   *
   * IMPORTANTE: este handler debe declararse ANTES de `@Get(':id')` para
   * que Nest no interprete `me` como un UUID inválido (ParseUUIDPipe lanza
   * BadRequest). Nest usa orden de declaración en el path matching.
   */
  @Get('me')
  @Roles('insured')
  findMe(@CurrentUser() user: AuthUser) {
    return this.insureds.findSelf(user);
  }

  /** Portal asegurado — coberturas del paquete del asegurado con consumo. */
  @Get('me/coverages')
  @Roles('insured')
  coveragesMe(@CurrentUser() user: AuthUser) {
    return this.insureds.coveragesForSelf(user);
  }

  @Get(':id')
  @Roles('admin_mac', 'operator', 'admin_segurasist', 'supervisor')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: { tenantId?: string },
    @Req() req: FastifyRequest & { user?: AuthUser; tenant?: TenantCtx },
  ) {
    return this.insureds.findOne(id, this.buildScope(req, q.tenantId));
  }

  /**
   * S3-06 — Vista 360° (datos + coberturas + eventos + certificados + audit).
   * RBAC: admin_segurasist, admin_mac, operator, supervisor. NO insured (su
   * portal usa `findSelf`).
   *
   * Anti-enumeration: si el id no existe (o pertenece a otro tenant) → 404.
   * NO 403, para no leakear UUIDs guess-resistantes (ver MVP_08 §enumeration).
   */
  @Get(':id/360')
  @Roles('admin_mac', 'operator', 'admin_segurasist', 'supervisor')
  find360(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: { tenantId?: string },
    @Req() req: FastifyRequest & { user?: AuthUser; tenant?: TenantCtx },
  ) {
    // F6 iter 2 H-01 — AuditContext canónico via factory (request-scoped).
    // Sustituye la extracción manual ad-hoc previa de {ip, userAgent, traceId}
    // por la lista única SENSITIVE_KEYS-aware del factory.
    return this.insureds.find360(id, this.buildScope(req, q.tenantId), this.auditCtx.fromRequest());
  }

  @Post()
  @Roles('admin_mac', 'operator', 'admin_segurasist')
  @UsePipes(new ZodValidationPipe(CreateInsuredSchema))
  create(@Body() dto: CreateInsuredDto, @Tenant() tenant: TenantCtx) {
    return this.insureds.create(dto, tenant);
  }

  @Patch(':id')
  @Roles('admin_mac', 'operator', 'admin_segurasist')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateInsuredSchema)) dto: UpdateInsuredDto,
    @Tenant() tenant: TenantCtx,
  ) {
    return this.insureds.update(id, dto, tenant);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin_mac', 'admin_segurasist')
  remove(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() tenant: TenantCtx): Promise<void> {
    return this.insureds.softDelete(id, tenant);
  }

  /**
   * S3-09 — Encolar exportación XLSX/PDF del listado filtrado.
   *
   * Anti-abuso (PII):
   *   - `@Throttle({ttl:60_000,limit:1})` → 1 export/min por (user+IP).
   *   - `ExportRateLimitGuard` → 10 exports/día por tenant (DB count).
   *   - El audit log se persiste antes del retorno.
   *
   * RBAC: admin_mac, operator, supervisor, admin_segurasist. Insureds NO
   * (no tienen acceso a este endpoint en su pool).
   *
   * Status code: 202 Accepted (job queued, not done). El cliente polea
   * `GET /v1/exports/:id` para el resultado.
   */
  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ ttl: 60_000, limit: 1 })
  @UseGuards(ExportRateLimitGuard)
  @Roles('admin_mac', 'operator', 'admin_segurasist', 'supervisor')
  exportRequest(
    @Body(new ZodValidationPipe(ExportRequestSchema)) dto: ExportRequestDto,
    @Tenant() tenant: TenantCtx,
    @Req() req: FastifyRequest & { user?: AuthUser },
  ) {
    const userId = req.user?.id;
    if (!userId) throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    // F6 iter 2 H-01 — propagar AuditContext canónico para el row de audit
    // `export`. El service combina con `actor.id` (que es el user del JWT).
    const ctx = this.auditCtx.fromRequest();
    return this.insureds.exportRequest(dto.format, dto.filters, tenant, {
      id: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      traceId: ctx.traceId,
    });
  }
}
