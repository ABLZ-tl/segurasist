import type { AuthUser } from '@common/decorators/current-user.decorator';
import { PrismaService } from '@common/prisma/prisma.service';
import type { AuditContext } from '@modules/audit/audit-context.factory';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { type Prisma, type ClaimType } from '@prisma/client';
import type { CreateClaimSelfDto } from './dto/claim.dto';

/**
 * Map del enum user-facing del DTO portal → enum DB `ClaimType`.
 *
 * El portal asegurado expone 4 tipos cortos (medical, dental, pharmacy,
 * other) para no abrumar al usuario; el schema de DB tiene un set más
 * granular (consultation, emergency, hospitalization, etc.). Mapeamos:
 *   - medical  → consultation (caso 80% del MVP)
 *   - dental   → other         (no hay enum 'dental' en MVP)
 *   - pharmacy → pharmacy
 *   - other    → other
 */
const CLAIM_TYPE_MAP: Record<CreateClaimSelfDto['type'], ClaimType> = {
  medical: 'consultation',
  dental: 'other',
  pharmacy: 'pharmacy',
  other: 'other',
};

export interface ClaimSelfResult {
  id: string;
  /** Ticket cortado para el FE: primer bloque del UUID + 'CL-'. */
  ticketNumber: string;
  status: 'reported';
  reportedAt: string;
}

@Injectable()
export class ClaimsService {
  private readonly log = new Logger(ClaimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly auditWriter?: AuditWriterService,
  ) {}

  list(): never {
    throw new NotImplementedException('ClaimsService.list');
  }

  create(): never {
    throw new NotImplementedException('ClaimsService.create');
  }

  update(): never {
    throw new NotImplementedException('ClaimsService.update');
  }

  /**
   * Portal asegurado — crea un claim "reported" para el insured autenticado.
   *
   * Flow:
   *   1. RBAC defensivo (role === 'insured').
   *   2. Lookup del insured por cognitoSub (RLS aplica el tenant del JWT).
   *   3. INSERT del claim con status='reported' + reportedAt=now.
   *   4. Audit log `action='create'`, `resourceType='claims'`,
   *      `payloadDiff={ subAction: 'reported', type, occurredAt }` —
   *      sin description (PII, queda en el row del claim de todos modos).
   *
   * Rate limit: el controller aplica `@Throttle({ttl:3600_000,limit:3})`
   * (3 reportes/hora por user-IP) — anti spam manual.
   */
  async createForSelf(
    user: AuthUser,
    dto: CreateClaimSelfDto,
    auditCtx?: AuditContext,
  ): Promise<ClaimSelfResult> {
    if (user.role !== 'insured') {
      throw new ForbiddenException('Endpoint solo para asegurados');
    }

    // H-16 — `cognitoSub` ya existe en Prisma client (schema Sprint 4); el
    // cast `as unknown as Prisma.InsuredWhereInput` quedó como deuda residual
    // cuando la migración estaba pending y se elimina para no esconder typos.
    const insured = await this.prisma.client.insured.findFirst({
      where: { cognitoSub: user.cognitoSub, deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (!insured) {
      // Anti-enumeration: 404 incluso si el rol es válido pero no existe el
      // insured en el tenant del JWT. NO 403, para alinear con findSelf.
      throw new NotFoundException('Asegurado no encontrado');
    }

    const dbType = CLAIM_TYPE_MAP[dto.type];
    const reportedAt = new Date();

    // El INSERT pasa por el client request-scoped — el RLS encadena el insert
    // al tenant del JWT (defensa en profundidad: aún si dto.tenantId fuera
    // inyectado por un atacante, el RLS lo sobrescribe).
    const created = await this.prisma.client.claim.create({
      data: {
        tenantId: insured.tenantId,
        insuredId: insured.id,
        type: dbType,
        reportedAt,
        description: dto.description,
        status: 'reported',
        metadata: {
          // Persistimos el tipo user-facing original + occurredAt en metadata
          // — el enum DB pierde la granularidad medical/dental.
          portalType: dto.type,
          occurredAt: dto.occurredAt,
        } as Prisma.InputJsonValue,
      },
    });

    if (this.auditWriter) {
      // H-24 — auditCtx (ip/userAgent/traceId) viene del controller via
      // AuditContextFactory.fromRequest(). Si llamado desde tests sin ctx,
      // los campos quedan undefined (writer los persiste como NULL).
      void this.auditWriter.record({
        tenantId: insured.tenantId,
        actorId: user.id,
        action: 'create',
        resourceType: 'claims',
        resourceId: created.id,
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        traceId: auditCtx?.traceId,
        payloadDiff: {
          subAction: 'reported',
          type: dto.type,
          occurredAt: dto.occurredAt,
        },
      });
    } else {
      this.log.log(
        { msg: 'claim.reported without auditWriter', claimId: created.id, actorId: user.id },
        'claim.reported',
      );
    }

    return {
      id: created.id,
      // Ticket corto user-friendly: 'CL-' + primeros 8 chars del UUID.
      ticketNumber: `CL-${created.id.slice(0, 8).toUpperCase()}`,
      status: 'reported',
      reportedAt: created.reportedAt.toISOString(),
    };
  }
}
