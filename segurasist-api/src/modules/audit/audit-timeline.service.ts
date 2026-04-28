/**
 * S4-09 — Timeline de auditoría para la vista 360 del asegurado.
 *
 * Estrategia de query:
 *   1. La fuente única de verdad son los `audit_log` rows filtrados por
 *      `tenant_id` (RLS automático para roles tenant-scoped vía
 *      `PrismaService`; superadmin caería al `PrismaBypassRlsService`, pero
 *      este endpoint es TENANT_ADMIN — sin platformAdmin).
 *   2. Eventos vinculados al asegurado se incluyen vía OR:
 *        a) `resourceType='insureds' AND resourceId=insuredId` — eventos
 *           directos sobre la entidad.
 *        b) `payloadDiff @> {"insuredId": <id>}` — eventos de claims,
 *           certificates, coverage_usage que llevan `insuredId` en el
 *           payload (Prisma JSONPath equals).
 *   3. Paginación keyset `(occurredAt DESC, id DESC)` — mismo cursor codec
 *      que `audit-cursor.ts`. Cursor opaco al cliente.
 *
 * Performance:
 *   - El index `(tenant_id, occurred_at DESC, id DESC)` ya existe (ver
 *     migration 20260125_audit_log_indexes). El JSON match es lento sin
 *     `GIN(payload_diff)`; aceptable para 5pts MVP — Sprint 5 puede agregar
 *     functional index si timeline carga >150ms p95.
 *   - `limit + 1` para detectar `hasMore` y construir nextCursor.
 *
 * Hidratación de actor email:
 *   - Best-effort lookup en `users` por los actorIds del page. NO bloquea si
 *     falla; `actorEmail = null` cuando no hay match (acción de sistema /
 *     worker).
 *
 * Export CSV:
 *   - `streamCsv` itera en chunks de 500 filas y emite líneas RFC 4180.
 *   - PII scrub aplicado: `userAgent` se trunca a 200 chars, IP enmascarada,
 *     payloadDiff serializado con keys sensibles ya scrubbeadas (el writer
 *     guarda el diff post-scrub upstream, pero ANTI-defensivo aquí también).
 */
import { PrismaService } from '@common/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor';

const TIMELINE_DEFAULT_LIMIT = 20;
const TIMELINE_MAX_LIMIT = 100;
const CSV_PAGE_SIZE = 500;
const CSV_HARD_CAP = 50_000;

export interface TimelineScope {
  tenantId: string;
}

export interface TimelineQueryOpts {
  insuredId: string;
  cursor?: string;
  limit?: number;
  actionFilter?: string;
}

export interface TimelineItem {
  id: string;
  occurredAt: Date;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  ipMasked: string | null;
  userAgent: string | null;
  payloadDiff: unknown;
}

export interface TimelineResult {
  items: TimelineItem[];
  nextCursor: string | null;
}

/**
 * Enmascara IP para reducir huella PII en pantalla. IPv4: último octeto → `*`.
 * IPv6: primeros 2 grupos + `::*`.
 */
export function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}::*`;
  }
  return ip;
}

/**
 * Escape RFC 4180: si la celda contiene `,`, `"`, `\n` o `\r`, la envolvemos
 * en `"..."` y duplicamos las `"` internas.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export const TIMELINE_CSV_HEADER = [
  'id',
  'occurredAt',
  'action',
  'resourceType',
  'resourceId',
  'actorId',
  'actorEmail',
  'ipMasked',
  'userAgent',
  'payloadDiff',
] as const;

@Injectable()
export class AuditTimelineService {
  private readonly log = new Logger(AuditTimelineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Página keyset de eventos. El where filtra por tenant + (insured directo
   * O payloadDiff.insuredId match). Orden DESC por (occurredAt, id).
   */
  async getTimeline(scope: TimelineScope, opts: TimelineQueryOpts): Promise<TimelineResult> {
    const limit = Math.min(Math.max(opts.limit ?? TIMELINE_DEFAULT_LIMIT, 1), TIMELINE_MAX_LIMIT);

    const where = this.buildWhere(scope, opts);

    const rows = await this.prisma.client.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const sliced = rows.slice(0, limit);
    const actorIds = Array.from(
      new Set(sliced.map((r) => r.actorId).filter((id): id is string => typeof id === 'string')),
    );
    const actorEmails = await this.hydrateActorEmails(actorIds);

    const items: TimelineItem[] = sliced.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      actorId: r.actorId,
      actorEmail: r.actorId ? (actorEmails.get(r.actorId) ?? null) : null,
      ipMasked: maskIp(r.ip),
      userAgent: r.userAgent,
      payloadDiff: r.payloadDiff,
    }));

    const last = sliced[sliced.length - 1];
    const nextCursor =
      rows.length > limit && last
        ? encodeAuditCursor({ id: last.id, occurredAt: last.occurredAt.toISOString() })
        : null;

    return { items, nextCursor };
  }

  /**
   * Generador async-yield para streaming CSV. Cada yield es una línea
   * terminada en `\r\n` (RFC 4180). El primer yield es el header.
   *
   * Hard cap: `CSV_HARD_CAP` filas. Sin cap, un export podría DoS-ear el
   * worker (memory + tiempo) — el throttle 2/min ya limita, pero defense-in-
   * depth.
   */
  async *streamCsv(scope: TimelineScope, insuredId: string): AsyncGenerator<string, void, void> {
    yield TIMELINE_CSV_HEADER.join(',') + '\r\n';

    const baseWhere = this.buildWhere(scope, { insuredId });

    let cursor: { id: string; occurredAt: Date } | null = null;
    let yielded = 0;

    while (yielded < CSV_HARD_CAP) {
      const where: Prisma.AuditLogWhereInput = cursor
        ? {
            AND: [
              baseWhere,
              {
                OR: [
                  { occurredAt: { lt: cursor.occurredAt } },
                  { AND: [{ occurredAt: cursor.occurredAt }, { id: { lt: cursor.id } }] },
                ],
              },
            ],
          }
        : baseWhere;

      const rows = await this.prisma.client.auditLog.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: CSV_PAGE_SIZE,
      });
      if (rows.length === 0) break;

      const actorIds = Array.from(
        new Set(rows.map((r) => r.actorId).filter((id): id is string => typeof id === 'string')),
      );
      const actorEmails = await this.hydrateActorEmails(actorIds);

      for (const r of rows) {
        if (yielded >= CSV_HARD_CAP) break;
        const cells = [
          r.id,
          r.occurredAt.toISOString(),
          r.action,
          r.resourceType,
          r.resourceId,
          r.actorId,
          r.actorId ? (actorEmails.get(r.actorId) ?? '') : '',
          maskIp(r.ip),
          // Truncamos UA a 200 chars: scrubbing + tamaño CSV.
          r.userAgent ? r.userAgent.slice(0, 200) : '',
          // payloadDiff puede ser objeto/array/null — JSON.stringify cubre todos.
          r.payloadDiff === null || r.payloadDiff === undefined ? '' : JSON.stringify(r.payloadDiff),
        ];
        yield cells.map(csvEscape).join(',') + '\r\n';
        yielded += 1;
      }

      const lastRow = rows[rows.length - 1];
      if (!lastRow || rows.length < CSV_PAGE_SIZE) break;
      cursor = { id: lastRow.id, occurredAt: lastRow.occurredAt };
    }
  }

  // ---- internals ----

  private buildWhere(scope: TimelineScope, opts: TimelineQueryOpts): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {
      tenantId: scope.tenantId,
      OR: [
        { resourceType: 'insureds', resourceId: opts.insuredId },
        // Eventos relacionados (claims/certificates/coverage_usage/etc)
        // que persisten `insuredId` en payloadDiff para esta correlación.
        // `path:['insuredId']` Prisma JSON filter — funciona en Postgres.
        { payloadDiff: { path: ['insuredId'], equals: opts.insuredId } },
      ],
    };

    if (opts.actionFilter) {
      // Cast a `AuditAction` enum: el caller (Zod schema en timeline.dto.ts)
      // ya valida el valor contra el set canónico. Si llegara un string
      // foráneo, Prisma tirará validation error (defense-in-depth).
      where.action = opts.actionFilter as AuditAction;
    }

    if (opts.cursor) {
      const decoded = decodeAuditCursor(opts.cursor);
      if (decoded) {
        const cursorClause: Prisma.AuditLogWhereInput = {
          OR: [
            { occurredAt: { lt: new Date(decoded.occurredAt) } },
            {
              AND: [{ occurredAt: new Date(decoded.occurredAt) }, { id: { lt: decoded.id } }],
            },
          ],
        };
        where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), cursorClause];
      }
    }

    return where;
  }

  private async hydrateActorEmails(actorIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (actorIds.length === 0) return out;
    try {
      const users = await this.prisma.client.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, email: true },
      });
      for (const u of users) {
        if (u.email) out.set(u.id, u.email);
      }
    } catch (err) {
      // Hidratación es best-effort; en lookup error preferimos timeline
      // sin emails que un 500.
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'AuditTimeline.hydrateActorEmails fallback (sin emails)',
      );
    }
    return out;
  }
}
