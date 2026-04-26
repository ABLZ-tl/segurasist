import type { AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { TenantCtx } from '@common/decorators/tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ReportsService, type ReportsScope } from './reports.service';

const DashboardQuerySchema = z.object({
  /** M2 — Sólo respetado para admin_segurasist; ignorado para roles tenant-scoped. */
  tenantId: z.string().uuid().optional(),
});

@Controller({ path: 'reports', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  private buildScope(
    req: FastifyRequest & { user?: AuthUser; tenant?: TenantCtx },
    queryTenantId: string | undefined,
  ): ReportsScope {
    const platformAdmin = req.user?.platformAdmin === true;
    return {
      platformAdmin,
      tenantId: platformAdmin ? queryTenantId : req.tenant?.id,
      actorId: req.user?.id,
    };
  }

  @Get('dashboard')
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  dashboard(
    @Query(new ZodValidationPipe(DashboardQuerySchema)) q: { tenantId?: string },
    @Req() req: FastifyRequest & { user?: AuthUser; tenant?: TenantCtx },
  ) {
    return this.reports.getDashboard(this.buildScope(req, q.tenantId));
  }

  // Endpoints legacy del Sprint 0 (stubs). Mantenemos la matriz RBAC.
  @Get('conciliation')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  conciliation() {
    return this.reports.conciliation();
  }

  @Get('volumetry')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  volumetry(
    @Query(new ZodValidationPipe(DashboardQuerySchema)) q: { tenantId?: string },
    @Req() req: FastifyRequest & { user?: AuthUser; tenant?: TenantCtx },
  ) {
    return this.reports.getVolumetrySeries(this.buildScope(req, q.tenantId));
  }

  @Get('usage')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  usage() {
    return this.reports.usage();
  }

  @Post('schedule')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  schedule() {
    return this.reports.schedule();
  }
}
