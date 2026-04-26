/**
 * AuditService — lectura de `/v1/audit/log` (Sprint 2 cierre de stubs).
 *
 * Reglas:
 *  - admin_mac / supervisor: scoped a su tenant via RLS automática del
 *    PrismaService request-scoped.
 *  - admin_segurasist (platformAdmin): cross-tenant via PrismaBypassRlsService;
 *    si query.tenantId presente lo respetamos (filtro explícito).
 *
 *  El AuditWriter persiste las filas con BYPASSRLS (es escritura administrativa);
 *  la lectura debe seguir el mismo path RBAC que los demás endpoints, por eso
 *  diferenciamos el cliente según platformAdmin.
 */
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor';
import { type AuditLogQuery } from './dto/audit.dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ip: string | null;
  userAgent: string | null;
  payloadDiff: unknown;
  traceId: string | null;
  occurredAt: Date;
  prevHash: string;
  rowHash: string;
}

export interface AuditLogResult {
  items: AuditLogEntry[];
  nextCursor: string | null;
}

export interface AuditCallerCtx {
  platformAdmin: boolean;
  tenantId?: string;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaBypass: PrismaBypassRlsService,
  ) {}

  async query(filter: AuditLogQuery, ctx: AuditCallerCtx): Promise<AuditLogResult> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const where: Prisma.AuditLogWhereInput = {};

    if (filter.actorId) where.actorId = filter.actorId;
    if (filter.action) where.action = filter.action as AuditAction;
    if (filter.resourceType) where.resourceType = filter.resourceType;
    if (filter.resourceId) where.resourceId = filter.resourceId;

    const occurredRange: { gte?: Date; lte?: Date } = {};
    if (filter.from) occurredRange.gte = new Date(filter.from);
    if (filter.to) occurredRange.lte = new Date(filter.to);
    if (Object.keys(occurredRange).length > 0) where.occurredAt = occurredRange;

    if (ctx.platformAdmin && filter.tenantId) where.tenantId = filter.tenantId;

    if (filter.cursor) {
      const decoded = decodeAuditCursor(filter.cursor);
      if (decoded) {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          {
            OR: [
              { occurredAt: { lt: new Date(decoded.occurredAt) } },
              {
                AND: [{ occurredAt: new Date(decoded.occurredAt) }, { id: { lt: decoded.id } }],
              },
            ],
          },
        ];
      }
    }

    const client = ctx.platformAdmin ? this.prismaBypass.client : this.prisma.client;
    const rows = await client.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const sliced = rows.slice(0, limit);
    const items: AuditLogEntry[] = sliced.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      actorId: r.actorId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      ip: r.ip,
      userAgent: r.userAgent,
      payloadDiff: r.payloadDiff,
      traceId: r.traceId,
      occurredAt: r.occurredAt,
      prevHash: r.prevHash,
      rowHash: r.rowHash,
    }));

    const hasMore = rows.length > limit;
    const last = sliced[sliced.length - 1];
    const nextCursor =
      hasMore && last ? encodeAuditCursor({ id: last.id, occurredAt: last.occurredAt.toISOString() }) : null;

    return { items, nextCursor };
  }
}
