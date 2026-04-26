import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller({ path: 'audit', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_segurasist', 'admin_mac', 'supervisor')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('log')
  list() {
    return this.audit.list();
  }
}
