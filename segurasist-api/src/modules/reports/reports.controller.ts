import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller({ path: 'reports', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_segurasist', 'admin_mac', 'supervisor')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('conciliation')
  conciliation() {
    return this.reports.conciliation();
  }

  @Get('volumetry')
  volumetry() {
    return this.reports.volumetry();
  }

  @Get('usage')
  usage() {
    return this.reports.usage();
  }

  @Post('schedule')
  schedule() {
    return this.reports.schedule();
  }
}
