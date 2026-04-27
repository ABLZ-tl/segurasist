/**
 * S3-09 — `GET /v1/exports/:id`.
 *
 * Endpoint dedicado de polling. Vive en el módulo `Insureds` porque hoy
 * sólo soporta `kind='insureds'`; cuando se agreguen reports adicionales
 * (claims, certs) se promueve a su propio módulo `ExportsModule`.
 *
 * Filtra por `requestedBy = user.id` (ver `InsuredsService.findExport`).
 * No expone listado — el cliente necesita conocer el `exportId` que el
 * POST `/v1/insureds/export` le devolvió.
 */
import type { AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { Tenant, TenantCtx } from '@common/decorators/tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { InsuredsService } from './insureds.service';

@Controller({ path: 'exports', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExportsController {
  constructor(private readonly insureds: InsuredsService) {}

  @Get(':id')
  @Roles('admin_mac', 'operator', 'admin_segurasist', 'supervisor')
  find(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Tenant() tenant: TenantCtx,
    @Req() req: FastifyRequest & { user?: AuthUser },
  ) {
    const userId = req.user?.id;
    if (!userId) throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    return this.insureds.findExport(id, tenant, { id: userId });
  }
}
