import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditChainVerifierService } from './audit-chain-verifier.service';
import { type AuditChainVerificationExtended } from './audit-writer.service';
import { AuditService } from './audit.service';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const VALID_SOURCES = new Set(['db', 's3', 'both']);

@Controller({ path: 'audit', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly verifier: AuditChainVerifierService,
  ) {}

  @Get('log')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  list() {
    return this.audit.list();
  }

  /**
   * Verifica la integridad de la cadena de hashes del audit_log para un
   * tenant. Sólo `admin_segurasist` (cross-tenant).
   *
   * Query params:
   *   - tenantId (required, UUID).
   *   - source (optional): 'db' | 's3' | 'both'. Default 'db' (preserva
   *     comportamiento del Sprint 1).
   *
   * Respuesta (`AuditChainVerificationExtended`):
   *   { valid, source, totalRows, brokenAtId?, discrepancies?, checkedAt }
   *
   *   - source='db': recomputa la cadena leyendo Postgres.
   *   - source='s3': recompone la cadena leyendo NDJSON del bucket inmutable.
   *   - source='both': cross-check fila a fila — `valid=false` si alguna fila
   *     mirroreada tiene `row_hash` distinto entre DB y S3 (tampering en el
   *     lado mutable). `discrepancies` lista las filas con conflicto.
   */
  @Get('verify-chain')
  @Roles('admin_segurasist')
  async verifyChain(
    @Query('tenantId') tenantId?: string,
    @Query('source') source?: string,
  ): Promise<AuditChainVerificationExtended> {
    if (!tenantId || !UUID_RE.test(tenantId)) {
      throw new BadRequestException('tenantId query param requerido (UUID)');
    }
    const src = source ?? 'db';
    if (!VALID_SOURCES.has(src)) {
      throw new BadRequestException("source debe ser 'db', 's3' o 'both'");
    }
    return this.verifier.verify(tenantId, src as 'db' | 's3' | 'both');
  }
}
