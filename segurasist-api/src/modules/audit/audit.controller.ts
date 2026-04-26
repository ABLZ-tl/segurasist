import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditWriterService, type AuditChainVerification } from './audit-writer.service';
import { AuditService } from './audit.service';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

@Controller({ path: 'audit', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly writer: AuditWriterService,
  ) {}

  @Get('log')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  list() {
    return this.audit.list();
  }

  /**
   * Verifica la integridad de la cadena de hashes del audit_log para un
   * tenant. Solo `admin_segurasist` (cross-tenant). Devuelve
   * `{valid, brokenAtId?, totalRows}`.
   */
  @Get('verify-chain')
  @Roles('admin_segurasist')
  async verifyChain(@Query('tenantId') tenantId?: string): Promise<AuditChainVerification> {
    if (!tenantId || !UUID_RE.test(tenantId)) {
      throw new BadRequestException('tenantId query param requerido (UUID)');
    }
    return this.writer.verifyChain(tenantId);
  }
}
