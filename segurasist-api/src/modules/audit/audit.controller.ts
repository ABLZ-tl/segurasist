import { CurrentUser, type AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { assertPlatformAdmin } from '@common/guards/assert-platform-admin';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Throttle } from '@common/throttler/throttler.decorators';
import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuditChainVerifierService } from './audit-chain-verifier.service';
import { type AuditChainVerificationExtended } from './audit-writer.service';
import { AuditService, type AuditCallerCtx } from './audit.service';
import { AuditLogQuerySchema, type AuditLogQuery } from './dto/audit.dto';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const VALID_SOURCES = new Set(['db', 's3', 'both']);

type ReqWithCtx = FastifyRequest & {
  user?: AuthUser & { platformAdmin?: boolean };
  tenant?: { id: string };
  bypassRls?: boolean;
};

@Controller({ path: 'audit', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly verifier: AuditChainVerifierService,
  ) {}

  @Get('log')
  @Roles('admin_segurasist', 'admin_mac', 'supervisor')
  list(
    @Query(new ZodValidationPipe(AuditLogQuerySchema)) q: AuditLogQuery,
    @Req() req: ReqWithCtx,
    @CurrentUser() user: AuthUser & { platformAdmin?: boolean },
  ) {
    const platformAdmin =
      user.platformAdmin === true || (user.role === 'admin_segurasist' && req.bypassRls === true);
    if (platformAdmin) {
      // H-14 — runtime defense-in-depth para PrismaBypassRlsService.
      assertPlatformAdmin(user);
    }
    const ctx: AuditCallerCtx = {
      platformAdmin,
      tenantId: req.tenant?.id,
    };
    return this.audit.query(q, ctx);
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
  // H-02 — verify-chain es operación cara (full table scan + ListObjectsV2 +
  // GetObject NDJSON + recompute SHA por fila). Sin throttle, un superadmin
  // con creds comprometidas puede DoS-ear el cluster recomputando cadenas
  // grandes (>100k filas por tenant). 2 req/min/IP es suficiente para
  // forensics manual; si el operador legítimo necesita más, usa CLI con
  // BYPASSRLS directo.
  @Get('verify-chain')
  @Roles('admin_segurasist')
  @Throttle({ ttl: 60_000, limit: 2 })
  async verifyChain(
    @CurrentUser() user: AuthUser & { platformAdmin?: boolean },
    @Query('tenantId') tenantId?: string,
    @Query('source') source?: string,
  ): Promise<AuditChainVerificationExtended> {
    // H-14 — defense-in-depth: el verifier corre con BYPASSRLS (cross-tenant
    // por construcción). Validamos role en runtime aunque el @Roles ya
    // restringe.
    assertPlatformAdmin(user);
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
