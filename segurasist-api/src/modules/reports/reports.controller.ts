import { Roles } from '@common/decorators/roles.decorator';
import { Tenant, TenantCtx } from '@common/decorators/tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller({ path: 'reports', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  dashboard(@Tenant() tenant: TenantCtx) {
    return this.reports.getDashboard(tenant);
  }

  // Endpoints legacy del Sprint 0 (stubs). Mantenemos la matriz RBAC.
  @Get('conciliation')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  conciliation() {
    return this.reports.conciliation();
  }

  @Get('volumetry')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  volumetry(@Tenant() tenant: TenantCtx) {
    return this.reports.getVolumetrySeries(tenant.id);
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
