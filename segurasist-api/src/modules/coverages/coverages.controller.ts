import type { AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { Tenant, TenantCtx } from '@common/decorators/tenant.decorator';
import { assertPlatformAdmin } from '@common/guards/assert-platform-admin';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CoverageInputSchema } from '../packages/dto/package.dto';
import { CoveragesService, type CoveragesScope } from './coverages.service';

/**
 * M2 — `packageId` ahora es opcional. Usos:
 *   - tenant-scoped + sin packageId: lista todas las coverages del tenant (RLS).
 *   - tenant-scoped + packageId: filtra por el paquete.
 *   - superadmin (platformAdmin=true): cross-tenant; respeta tenantId opcional.
 * `tenantId` lo respetamos sólo para superadmin (RolesGuard); el resto
 * lo ignora silenciosamente — RLS lo enforza.
 */
const ListCoveragesQuerySchema = z.object({
  packageId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
});
const UpsertCoveragesSchema = z.object({
  coverages: z.array(CoverageInputSchema).max(40),
});

/**
 * S2-02 — coverages controller.
 *
 * Endpoints reales:
 *  - GET  /v1/coverages?packageId=<uuid> → list de coverages de un package
 *  - PUT  /v1/coverages/:packageId       → upsert atómico del set
 *
 * Endpoints legacy (POST/PATCH/DELETE) preservados para backward compat
 * con la matriz e2e RBAC de Sprint 1; redirigen al upsert o devuelven 410
 * (GONE) según semántica. NO recomendamos su uso — sólo viven hasta que el
 * FE migre a los endpoints reales.
 */
@Controller({ path: 'coverages', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class CoveragesController {
  constructor(private readonly coverages: CoveragesService) {}

  @Get()
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  list(
    @Query(new ZodValidationPipe(ListCoveragesQuerySchema))
    q: { packageId?: string; tenantId?: string },
    @Req() req: FastifyRequest & { user?: AuthUser; tenant?: TenantCtx },
  ) {
    const platformAdmin = req.user?.platformAdmin === true;
    if (platformAdmin) {
      // H-14 — runtime defense-in-depth para PrismaBypassRlsService.
      assertPlatformAdmin(req.user);
    }
    const scope: CoveragesScope = {
      platformAdmin,
      tenantId: platformAdmin ? q.tenantId : req.tenant?.id,
      actorId: req.user?.id,
    };
    return this.coverages.list(q.packageId ?? null, scope);
  }

  @Put(':packageId')
  @Roles('admin_segurasist')
  upsert(
    @Param('packageId', new ParseUUIDPipe()) packageId: string,
    @Body(new ZodValidationPipe(UpsertCoveragesSchema))
    body: { coverages: z.infer<typeof CoverageInputSchema>[] },
    @Tenant() tenant: TenantCtx,
  ) {
    return this.coverages.upsertForPackage(packageId, body.coverages, tenant);
  }

  // Legacy stubs (RBAC matrix Sprint 1). Mantienen el contrato @Roles para no
  // romper rbac.e2e-spec.ts; el shape de la respuesta es 410 GONE con un
  // mensaje claro hacia los endpoints nuevos.
  @Post()
  @Roles('admin_segurasist')
  legacyCreate(): never {
    throw new HttpException(
      'POST /v1/coverages está desactivado. Usa PUT /v1/coverages/:packageId',
      HttpStatus.GONE,
    );
  }

  @Patch(':id')
  @Roles('admin_segurasist')
  legacyUpdate(@Param('id', new ParseUUIDPipe()) _id: string): never {
    throw new HttpException(
      'PATCH /v1/coverages/:id está desactivado. Usa PUT /v1/coverages/:packageId',
      HttpStatus.GONE,
    );
  }

  @Delete(':id')
  @Roles('admin_segurasist')
  legacyDelete(@Param('id', new ParseUUIDPipe()) _id: string): never {
    throw new HttpException(
      'DELETE /v1/coverages/:id está desactivado. Archiva el package vía DELETE /v1/packages/:id',
      HttpStatus.GONE,
    );
  }
}
