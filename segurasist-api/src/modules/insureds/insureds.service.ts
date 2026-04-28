/**
 * S2-06 — InsuredsService.
 *
 * `list` implementa cursor-paginated con compound (createdAt, id) para
 * estabilidad ante created_at duplicados. Filtros:
 *   - q          → búsqueda fuzzy en (full_name, curp, rfc) usando ILIKE.
 *                  El índice GIN trigram (`pg_trgm`) creado en la migración
 *                  20260426_insureds_search_indexes acelera ILIKE %q% a O(log n).
 *   - packageId  → eq.
 *   - status     → eq.
 *   - validFromGte/Lte / validToGte/Lte → rangos.
 *   - bouncedOnly → EXISTS sub-query contra email_events tipo bounced.
 *
 * RBAC + RLS: el controller fija `@Roles(...)` y `PrismaService` agrega
 * `app.current_tenant`. El service NO necesita pasar tenantId al WHERE — RLS lo hace.
 *
 * Performance objetivo (story): p95 ≤ 2s con 60k filas. Plan EXPLAIN ANALYZE
 * verifica:
 *   1. Index Scan on insureds_search_idx (gin) cuando hay `q`.
 *   2. Index Scan on (tenant_id, status, valid_to) cuando hay status+validTo.
 *
 * Stub create/update/softDelete: el alta principal viene por batches (S1-05);
 * el alta unitaria queda para sprint 3.
 */
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@common/decorators/current-user.decorator';
import { TenantCtx } from '@common/decorators/tenant.decorator';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { ENV_TOKEN } from '@config/config.module';
import type { Env } from '@config/env.schema';
import { S3Service } from '@infra/aws/s3.service';
import { SqsService } from '@infra/aws/sqs.service';
import type { AuditContext } from '@modules/audit/audit-context.factory';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { decodeCursor, encodeCursor } from './cursor';
import {
  EXPORT_ROW_HARD_CAP,
  type ExportFilters,
  type ExportRequestResult,
  type ExportStatusResponse,
} from './dto/export.dto';
import { CreateInsuredDto, ListInsuredsQuery, UpdateInsuredDto } from './dto/insured.dto';
import { buildInsuredsWhere } from './where-builder';

/** Presigned download TTL (24h, deliberadamente menor que certificados que duran 7d). */
const EXPORT_DOWNLOAD_TTL_SECONDS = 24 * 60 * 60;
/** Kind único soportado en MVP. */
const EXPORT_KIND = 'insureds';
/** Evento SQS para el reports-worker. */
const EXPORT_EVENT_KIND = 'export.requested';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Contexto de scope para los métodos de lectura. Permite que el mismo service
 * sirva al path tenant-scoped (`platformAdmin=false`, requiere tenantId del JWT)
 * y al path superadmin cross-tenant (`platformAdmin=true`, lee con BYPASSRLS).
 */
export interface InsuredsScope {
  platformAdmin: boolean;
  /** Tenant a filtrar. En path RLS, lo provee el JWT. En path superadmin, opcional. */
  tenantId?: string;
  /** id del actor — sólo usado para logging del bypass. */
  actorId?: string;
}

export interface InsuredListItem {
  id: string;
  curp: string;
  rfc: string | null;
  fullName: string;
  packageId: string;
  packageName: string;
  status: 'active' | 'suspended' | 'cancelled' | 'expired';
  validFrom: string;
  validTo: string;
  email: string | null;
  hasBounce: boolean;
}

export interface InsuredListResult {
  items: InsuredListItem[];
  nextCursor: string | null;
  prevCursor: string | null;
}

type InsuredFindMany = PrismaClient['insured']['findMany'];
type CertificateFindMany = PrismaClient['certificate']['findMany'];
type EmailEventFindMany = PrismaClient['emailEvent']['findMany'];
type InsuredFindFirst = PrismaClient['insured']['findFirst'];
type ClaimFindMany = PrismaClient['claim']['findMany'];
type CoverageFindMany = PrismaClient['coverage']['findMany'];
type CoverageUsageFindMany = PrismaClient['coverageUsage']['findMany'];
type AuditLogFindMany = PrismaClient['auditLog']['findMany'];
type UserFindMany = PrismaClient['user']['findMany'];

interface ReadClient {
  insured: { findMany: InsuredFindMany; findFirst: InsuredFindFirst };
  certificate: { findMany: CertificateFindMany };
  emailEvent: { findMany: EmailEventFindMany };
  claim: { findMany: ClaimFindMany };
  coverage: { findMany: CoverageFindMany };
  coverageUsage: { findMany: CoverageUsageFindMany };
  auditLog: { findMany: AuditLogFindMany };
  user: { findMany: UserFindMany };
}

/**
 * Vista 360° del asegurado — datos personales + póliza + coberturas (con
 * consumo agregado) + eventos (claims) + certificados + audit log.
 *
 * Diseñada para una sola request del admin: el FE pinta tabs sin re-pegar al
 * backend por cada uno. Las 5 secciones se obtienen en paralelo con
 * `Promise.allSettled` para que un timeout en (p.ej.) audit no bloquee el
 * resto — cada sección que falle queda en `[]` y se loguea, pero la respuesta
 * sigue siendo 200 (el FE muestra empty state en ese tab).
 */
export interface Insured360 {
  insured: {
    id: string;
    curp: string;
    rfc: string | null;
    fullName: string;
    dob: string;
    email: string | null;
    phone: string | null;
    packageId: string;
    packageName: string;
    validFrom: string;
    validTo: string;
    status: 'active' | 'suspended' | 'cancelled' | 'expired';
    entidad: string | null;
    numeroEmpleadoExterno: string | null;
    beneficiaries: Array<{ id: string; fullName: string; dob: string; relationship: string }>;
    createdAt: string;
    updatedAt: string;
  };
  coverages: Array<{
    id: string;
    name: string;
    type: 'count' | 'amount';
    limit: number;
    used: number;
    unit: string;
    lastUsedAt: string | null;
  }>;
  events: Array<{
    id: string;
    type: string;
    reportedAt: string;
    description: string;
    status: string;
    amountEstimated: number | null;
  }>;
  certificates: Array<{
    id: string;
    version: number;
    issuedAt: string;
    validTo: string;
    status: string;
    hash: string;
    qrPayload: string | null;
  }>;
  audit: Array<{
    id: string;
    action: string;
    actorEmail: string;
    resourceType: string;
    resourceId: string;
    occurredAt: string;
    ip: string;
    payloadDiff: Record<string, unknown> | null;
  }>;
}

const AUDIT_360_LIMIT = 50;

/**
 * Portal asegurado — vista "self".
 *
 * Devuelta por `findSelf(user)` para `GET /v1/insureds/me`. Incluye un
 * status user-friendly (vigente / proxima_a_vencer / vencida) calculado a
 * partir de `validTo` vs hoy, y un `supportPhone` que el FE muestra como CTA.
 *
 * `daysUntilExpiry` es positivo si la póliza aún es vigente, 0 si vence hoy,
 * y negativo si ya venció.
 */
export interface InsuredSelf {
  id: string;
  fullName: string;
  packageId: string;
  packageName: string;
  validFrom: string;
  validTo: string;
  status: 'vigente' | 'proxima_a_vencer' | 'vencida';
  daysUntilExpiry: number;
  supportPhone: string;
}

/**
 * Portal asegurado — coberturas con consumo agregado.
 *
 * Devuelta por `coveragesForSelf(user)` para `GET /v1/insureds/me/coverages`.
 * Una entrada por cada `Coverage` del paquete del asegurado, con el `used`
 * total computado de `coverage_usage`.
 */
export interface CoverageSelf {
  id: string;
  name: string;
  type: 'count' | 'amount';
  limit: number;
  used: number;
  unit: string;
  lastUsedAt: string | null;
}

/** Fallback hardcoded del soporte MVP — el FE lo usa para CTA WhatsApp/Tel. */
const DEFAULT_SUPPORT_PHONE = '+528000000000';
/** Umbral en días para marcar la póliza como `proxima_a_vencer`. */
const EXPIRY_WARNING_DAYS = 7;
/** ms en un día — para el cálculo de `daysUntilExpiry`. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class InsuredsService {
  private readonly log = new Logger(InsuredsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bypass: PrismaBypassRlsService,
    @Optional() private readonly auditWriter?: AuditWriterService,
    @Optional() private readonly sqs?: SqsService,
    @Optional() private readonly s3?: S3Service,
    @Optional() @Inject(ENV_TOKEN) private readonly env?: Env,
  ) {}

  /**
   * Selecciona el cliente Prisma adecuado según el scope:
   *   - `platformAdmin=true`  → bypass (segurasist_admin BYPASSRLS, cross-tenant)
   *   - `platformAdmin=false` → request-scoped (segurasist_app NOBYPASSRLS, RLS)
   *
   * El path bypass se loguea para auditabilidad — `actor` y `tenantQuery`
   * (filtro opcional pasado como query param) quedan en el log estructurado.
   */
  private clientFor(scope: InsuredsScope): ReadClient {
    if (scope.platformAdmin) {
      this.log.log(
        { msg: 'platform admin bypass', actor: scope.actorId ?? null, query: scope.tenantId ?? null },
        'platform admin bypass',
      );
      return this.bypass.client as unknown as ReadClient;
    }
    return this.prisma.client as unknown as ReadClient;
  }

  async list(query: ListInsuredsQuery, scope: InsuredsScope): Promise<InsuredListResult> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const client = this.clientFor(scope);

    // H-17 — `list`, `buildExportWhere` y `reports-worker.queryInsureds`
    // comparten la misma forma de filtros (q/status/packageId/validFrom/To).
    // El builder centraliza el OR fuzzy + ranges para que filtros nuevos
    // toquen UN solo sitio (ver `where-builder.ts`).
    const where = buildInsuredsWhere(query);
    // Path superadmin: tenantId opcional (cross-tenant si no se pasa).
    // Path RLS: el filtro lo aplica `app.current_tenant`; el tenantId del scope
    // (que viene del JWT) ya está implícito y no necesita where adicional.
    if (scope.platformAdmin && scope.tenantId) {
      where.tenantId = scope.tenantId;
    }

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (!decoded) {
        // Cursor corrupto: tratamos como sin-cursor (defensa contra clientes
        // que arman manualmente). Alternativa sería 400; preferimos UX.
      } else {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          {
            OR: [
              { createdAt: { lt: new Date(decoded.createdAt) } },
              {
                AND: [{ createdAt: new Date(decoded.createdAt) }, { id: { lt: decoded.id } }],
              },
            ],
          },
        ];
      }
    }

    const rows = await client.insured.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { package: { select: { id: true, name: true } } },
    });

    const sliced = rows.slice(0, limit);

    // Hard bounce flag: una sola query por página.
    const ids = sliced.map((r) => r.id);
    const bouncedSet = new Set<string>();
    if (query.bouncedOnly === true || ids.length > 0) {
      // EmailEvent no liga a insured directamente sino a certificate; así que
      // resolvemos por insured → certificates → email_events. Hacemos una sola
      // ronda con groupBy para minimizar overhead.
      const certs = await client.certificate.findMany({
        where: { insuredId: { in: ids } },
        select: { id: true, insuredId: true },
      });
      const certByInsured = new Map<string, string[]>();
      for (const c of certs) {
        const arr = certByInsured.get(c.insuredId) ?? [];
        arr.push(c.id);
        certByInsured.set(c.insuredId, arr);
      }
      const allCertIds = certs.map((c) => c.id);
      if (allCertIds.length > 0) {
        const bouncedEvents = await client.emailEvent.findMany({
          where: {
            certificateId: { in: allCertIds },
            eventType: 'bounced',
          },
          select: { certificateId: true },
        });
        const bouncedCertIds = new Set(
          bouncedEvents.map((e) => e.certificateId).filter((c): c is string => Boolean(c)),
        );
        for (const [insuredId, certIds] of certByInsured) {
          if (certIds.some((id) => bouncedCertIds.has(id))) {
            bouncedSet.add(insuredId);
          }
        }
      }
    }

    let items: InsuredListItem[] = sliced.map((r) => ({
      id: r.id,
      curp: r.curp,
      rfc: r.rfc,
      fullName: r.fullName,
      packageId: r.packageId,
      packageName: r.package.name,
      status: r.status,
      validFrom: r.validFrom.toISOString().slice(0, 10),
      validTo: r.validTo.toISOString().slice(0, 10),
      email: r.email,
      hasBounce: bouncedSet.has(r.id),
    }));

    if (query.bouncedOnly === true) {
      items = items.filter((i) => i.hasBounce);
    }

    const hasMore = rows.length > limit;
    const last = sliced[sliced.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ id: last.id, createdAt: last.createdAt.toISOString() }) : null;

    return {
      items,
      nextCursor,
      // No tracking de prev-cursor para mantener cursor unidireccional simple;
      // el FE reconstruye history via TanStack Query infinite.
      prevCursor: null,
    };
  }

  async findOne(id: string, scope: InsuredsScope): Promise<unknown> {
    const client = this.clientFor(scope);
    const where: Prisma.InsuredWhereInput = { id, deletedAt: null };
    if (scope.platformAdmin && scope.tenantId) where.tenantId = scope.tenantId;
    const row = await client.insured.findFirst({
      where,
      include: { package: true, beneficiaries: { where: { deletedAt: null } } },
    });
    if (!row) throw new NotFoundException('Insured not found');
    return row;
  }

  /**
   * S3-06 — vista 360° del asegurado (datos + coberturas + eventos +
   * certificados + audit). Las 5 secciones se obtienen en paralelo via
   * `Promise.allSettled` para que un timeout puntual no bloquee a las
   * demás. El insured-base ES bloqueante: si no existe → 404
   * (anti-enumeration: NO 403 para no diferenciar entre "no existe" y "no
   * autorizado").
   *
   * Audit: persiste `action='read_viewed'` con `resourceType='insureds'`
   * (fire-and-forget). F6 iter 2 H-01: antes era `action='read'` con
   * `payloadDiff.subAction='viewed_360'` (overload semántico) — ahora el
   * enum `AuditAction` extendido (migration 20260428_audit_action_enum_extend)
   * permite queries SQL eficientes por action sin scan JSON.
   *
   * Tenant isolation: usamos siempre `clientFor(scope)`. En path
   * tenant-scoped, RLS filtra automáticamente; el `where.tenantId` adicional
   * es defense-in-depth para platformAdmin.
   */
  async find360(
    id: string,
    scope: InsuredsScope,
    auditCtx?: AuditContext,
  ): Promise<Insured360> {
    const client = this.clientFor(scope);
    const baseWhere: Prisma.InsuredWhereInput = { id, deletedAt: null };
    if (scope.platformAdmin && scope.tenantId) baseWhere.tenantId = scope.tenantId;

    // Insured base es bloqueante — el resto se cuelga de su tenantId/packageId.
    const base = await client.insured.findFirst({
      where: baseWhere,
      include: {
        package: { select: { id: true, name: true } },
        beneficiaries: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!base) {
      // Anti-enumeration: 404 incluso si el row existe pero pertenece a otro
      // tenant (RLS lo filtra) — nunca distinguimos "no existe" vs "no autorizado".
      throw new NotFoundException('Insured not found');
    }

    const insuredTenantId = base.tenantId;

    // 5 queries en paralelo. allSettled: si una falla la dejamos en [] y
    // logueamos; el FE muestra empty state por sección.
    const [coveragesRes, claimsRes, certificatesRes, auditRes, usagesRes] = await Promise.allSettled([
      client.coverage.findMany({
        where: { packageId: base.packageId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
      client.claim.findMany({
        where: { insuredId: id, deletedAt: null },
        orderBy: { reportedAt: 'desc' },
        take: 100,
      }),
      client.certificate.findMany({
        where: { insuredId: id, deletedAt: null },
        orderBy: { version: 'desc' },
      }),
      client.auditLog.findMany({
        where: { resourceType: 'insureds', resourceId: id },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: AUDIT_360_LIMIT,
      }),
      client.coverageUsage.findMany({
        where: { insuredId: id },
        orderBy: { usedAt: 'desc' },
      }),
    ]);

    const coveragesRows = settled(coveragesRes, 'find360.coverages', this.log);
    const claimsRows = settled(claimsRes, 'find360.claims', this.log);
    const certificatesRows = settled(certificatesRes, 'find360.certificates', this.log);
    const auditRows = settled(auditRes, 'find360.audit', this.log);
    const usageRows = settled(usagesRes, 'find360.usages', this.log);

    // Hidratamos actor.email en el audit log con un solo SELECT IN(...) para
    // evitar N+1. Si la query falla → emails vacíos (no rompe la respuesta).
    const actorIds = Array.from(
      new Set(auditRows.map((r) => r.actorId).filter((x): x is string => Boolean(x))),
    );
    const actors =
      actorIds.length === 0
        ? []
        : await client.user
            .findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })
            .catch((err: unknown) => {
              this.log.warn(
                { err: err instanceof Error ? err.message : String(err) },
                'find360 actors hydrate failed; emails vacíos',
              );
              return [] as Array<{ id: string; email: string }>;
            });
    const actorEmailById = new Map(actors.map((a) => [a.id, a.email]));

    // Agregaciones de consumo por coverage.
    const usageByCoverage = new Map<string, { count: number; amount: number; lastAt: Date | null }>();
    for (const u of usageRows) {
      const k = u.coverageId;
      const cur = usageByCoverage.get(k) ?? { count: 0, amount: 0, lastAt: null };
      cur.count += 1;
      if (u.amount !== null && u.amount !== undefined) {
        cur.amount += Number(u.amount);
      }
      if (!cur.lastAt || u.usedAt > cur.lastAt) cur.lastAt = u.usedAt;
      usageByCoverage.set(k, cur);
    }

    // Metadata Insured: la migración del schema no expone `entidad` ni
    // `numeroEmpleadoExterno` como columnas first-class (vienen del CSV
    // batch en `metadata.entidad`/`metadata.numeroEmpleado`). Los leemos
    // defensivamente del JSON.
    const meta =
      base.metadata && typeof base.metadata === 'object' && !Array.isArray(base.metadata)
        ? (base.metadata as Record<string, unknown>)
        : {};
    const entidad = typeof meta.entidad === 'string' ? meta.entidad : null;
    const numeroEmpleadoExterno =
      typeof meta.numeroEmpleadoExterno === 'string'
        ? meta.numeroEmpleadoExterno
        : typeof meta.numeroEmpleado === 'string'
          ? meta.numeroEmpleado
          : null;

    const result: Insured360 = {
      insured: {
        id: base.id,
        curp: base.curp,
        rfc: base.rfc,
        fullName: base.fullName,
        dob: base.dob.toISOString().slice(0, 10),
        email: base.email,
        phone: base.phone,
        packageId: base.packageId,
        packageName: base.package.name,
        validFrom: base.validFrom.toISOString().slice(0, 10),
        validTo: base.validTo.toISOString().slice(0, 10),
        status: base.status,
        entidad,
        numeroEmpleadoExterno,
        beneficiaries: base.beneficiaries.map((b) => ({
          id: b.id,
          fullName: b.fullName,
          dob: b.dob.toISOString().slice(0, 10),
          relationship: b.relationship,
        })),
        createdAt: base.createdAt.toISOString(),
        updatedAt: base.updatedAt.toISOString(),
      },
      coverages: coveragesRows.map((c) => {
        const usage = usageByCoverage.get(c.id);
        // Mapeo enum DB → user-facing: si el limit primario es count, tipo='count'.
        const isCount = c.limitCount !== null && c.limitCount !== undefined;
        const limit = isCount
          ? Number(c.limitCount)
          : c.limitAmount !== null && c.limitAmount !== undefined
            ? Number(c.limitAmount)
            : 0;
        const used = isCount ? (usage?.count ?? 0) : (usage?.amount ?? 0);
        const type: 'count' | 'amount' = isCount ? 'count' : 'amount';
        return {
          id: c.id,
          name: c.name,
          type,
          limit,
          used,
          unit: isCount ? 'eventos' : 'MXN',
          lastUsedAt: usage?.lastAt ? usage.lastAt.toISOString() : null,
        };
      }),
      events: claimsRows.map((cl) => ({
        id: cl.id,
        type: cl.type,
        reportedAt: cl.reportedAt.toISOString(),
        description: cl.description,
        status: cl.status,
        amountEstimated:
          cl.amountEstimated === null || cl.amountEstimated === undefined ? null : Number(cl.amountEstimated),
      })),
      certificates: certificatesRows.map((cer) => ({
        id: cer.id,
        version: cer.version,
        issuedAt: cer.issuedAt.toISOString(),
        validTo: cer.validTo.toISOString().slice(0, 10),
        status: cer.status,
        hash: cer.hash,
        qrPayload: cer.qrPayload ?? null,
      })),
      audit: auditRows.map((a) => ({
        id: a.id,
        action: a.action,
        actorEmail: a.actorId ? (actorEmailById.get(a.actorId) ?? '') : '',
        resourceType: a.resourceType,
        resourceId: a.resourceId ?? '',
        occurredAt: a.occurredAt.toISOString(),
        ip: a.ip ?? '',
        payloadDiff:
          a.payloadDiff && typeof a.payloadDiff === 'object' && !Array.isArray(a.payloadDiff)
            ? (a.payloadDiff as Record<string, unknown>)
            : null,
      })),
    };

    // Audit fire-and-forget (F6 iter 2 H-01): action='read_viewed' (enum
    // extendido) reemplaza el overload payloadDiff.subAction='viewed_360'.
    // ip/userAgent/traceId vienen del AuditContext canónico que el controller
    // deriva via AuditContextFactory.fromRequest() — drift entre callers cero.
    if (this.auditWriter) {
      void this.auditWriter.record({
        tenantId: insuredTenantId,
        actorId: scope.actorId,
        action: 'read_viewed',
        resourceType: 'insureds',
        resourceId: id,
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        traceId: auditCtx?.traceId,
      });
    }

    return result;
  }

  /**
   * Portal asegurado — devuelve los datos del propio asegurado autenticado.
   *
   * RBAC defensivo: aún cuando el RolesGuard ya impone `@Roles('insured')`
   * a nivel handler, este service comprueba `user.role` para que un caller
   * mal configurado no leak datos de otro recurso. La query usa
   * `prisma.client` request-scoped (RLS aplica `app.current_tenant`); si el
   * cognitoSub no matchea ningún insured del tenant del JWT → 404 (NO 403,
   * para no diferenciar "no existe" vs "no autorizado", anti-enumeration).
   *
   * `status` se derivó del campo `validTo`:
   *   - `vencida`            → ya venció (validTo < today)
   *   - `proxima_a_vencer`   → vence en ≤ 7 días
   *   - `vigente`            → caso contrario
   *
   * `supportPhone` viene de `tenant.brandJson.supportPhone` si el tenant lo
   * configuró; caso contrario fallback hardcoded MVP `+528000000000`. NOTA:
   * el schema actual del Tenant expone `brandJson` (no `metadata`), así que
   * leemos ahí defensivamente.
   */
  async findSelf(user: AuthUser): Promise<InsuredSelf> {
    if (user.role !== 'insured') {
      throw new ForbiddenException('Endpoint solo para asegurados');
    }
    // H-16 — la columna `cognitoSub` ya está en el schema (Prisma client
    // generado post-migración Sprint 4: ver `Insured.cognitoSub` y
    // `@@unique([cognitoSub])`). El cast `as unknown as Prisma.InsuredWhereInput`
    // anterior era deuda residual cuando la migración estaba pending; ya no
    // es necesario y se elimina para que el typing detecte regresiones.
    const insured = await this.prisma.client.insured.findFirst({
      where: { cognitoSub: user.cognitoSub, deletedAt: null },
      include: { package: true, tenant: true },
    });
    if (!insured) {
      throw new NotFoundException('Asegurado no encontrado');
    }

    const today = startOfDay(new Date());
    const validTo = startOfDay(insured.validTo);
    const daysUntilExpiry = Math.round((validTo.getTime() - today.getTime()) / MS_PER_DAY);

    let status: InsuredSelf['status'];
    if (daysUntilExpiry < 0) {
      status = 'vencida';
    } else if (daysUntilExpiry <= EXPIRY_WARNING_DAYS) {
      status = 'proxima_a_vencer';
    } else {
      status = 'vigente';
    }

    // Tenant.brandJson es Json? — hacemos lookup defensivo del key supportPhone.
    const tenantBrand =
      insured.tenant.brandJson &&
      typeof insured.tenant.brandJson === 'object' &&
      !Array.isArray(insured.tenant.brandJson)
        ? (insured.tenant.brandJson as Record<string, unknown>)
        : {};
    const supportPhone =
      typeof tenantBrand.supportPhone === 'string' && tenantBrand.supportPhone.length > 0
        ? tenantBrand.supportPhone
        : DEFAULT_SUPPORT_PHONE;

    return {
      id: insured.id,
      fullName: insured.fullName,
      packageId: insured.packageId,
      packageName: insured.package.name,
      validFrom: insured.validFrom.toISOString().slice(0, 10),
      validTo: insured.validTo.toISOString().slice(0, 10),
      status,
      daysUntilExpiry,
      supportPhone,
    };
  }

  /**
   * Portal asegurado — devuelve las coberturas del paquete del asegurado
   * con el consumo agregado por cobertura (count o amount, según el tipo
   * de la cobertura).
   *
   * Reusa `findSelf` para localizar el insuredId/packageId — esto centraliza
   * el RBAC + 404 anti-enumeration. Una vez resuelto, hace 1 SELECT a
   * `coverages` y N agregaciones a `coverage_usage` (una por cobertura). En
   * MVP cada paquete tiene ~5 coberturas; aceptable como N+1 controlado.
   */
  async coveragesForSelf(user: AuthUser): Promise<CoverageSelf[]> {
    // findSelf ya valida role + busca el insured. Reusamos su path.
    const self = await this.findSelf(user);
    // Necesitamos el insuredId real para los aggregates. findSelf lo devuelve.
    const insuredId = self.id;

    const coverages = await this.prisma.client.coverage.findMany({
      where: { packageId: self.packageId, deletedAt: null },
      orderBy: { name: 'asc' },
    });

    // Aggregates en paralelo: 1 query por coverage. Más simple que un GROUP BY
    // y suficientemente rápido para los ~5 coverages típicos de MVP.
    const aggregates = await Promise.all(
      coverages.map((c) =>
        this.prisma.client.coverageUsage.aggregate({
          where: { insuredId, coverageId: c.id },
          _sum: { amount: true },
          _count: { id: true },
          _max: { usedAt: true },
        }),
      ),
    );

    return coverages.map((c, i) => {
      const agg = aggregates[i];
      // Si la cobertura define limitCount, es 'count'; si define limitAmount,
      // es 'amount'. El mapping coincide con el de find360.
      const isCount = c.limitCount !== null && c.limitCount !== undefined;
      const limit = isCount
        ? Number(c.limitCount)
        : c.limitAmount !== null && c.limitAmount !== undefined
          ? Number(c.limitAmount)
          : 0;
      const used = isCount
        ? (agg?._count?.id ?? 0)
        : agg?._sum?.amount === null || agg?._sum?.amount === undefined
          ? 0
          : Number(agg._sum.amount);
      const lastUsedAt = agg?._max?.usedAt ? agg._max.usedAt.toISOString() : null;
      return {
        id: c.id,
        name: c.name,
        type: isCount ? 'count' : 'amount',
        limit,
        used,
        unit: isCount ? 'eventos' : 'MXN',
        lastUsedAt,
      };
    });
  }

  async create(dto: CreateInsuredDto, tenant: TenantCtx): Promise<unknown> {
    try {
      return await this.prisma.withTenant((tx) =>
        tx.insured.create({
          data: {
            tenantId: tenant.id,
            curp: dto.curp,
            rfc: dto.rfc ?? null,
            fullName: dto.fullName,
            dob: new Date(dto.dob),
            email: dto.email ?? null,
            phone: dto.phone ?? null,
            packageId: dto.packageId,
            validFrom: new Date(dto.validFrom),
            validTo: new Date(dto.validTo),
          },
        }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Insured CURP already exists in this tenant');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateInsuredDto, _tenant: TenantCtx): Promise<unknown> {
    const existing = await this.prisma.client.insured.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Insured not found');
    return this.prisma.withTenant((tx) =>
      tx.insured.update({
        where: { id },
        data: {
          rfc: dto.rfc ?? undefined,
          fullName: dto.fullName ?? undefined,
          dob: dto.dob ? new Date(dto.dob) : undefined,
          email: dto.email ?? undefined,
          phone: dto.phone ?? undefined,
          packageId: dto.packageId ?? undefined,
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validTo: dto.validTo ? new Date(dto.validTo) : undefined,
        },
      }),
    );
  }

  async softDelete(id: string, _tenant: TenantCtx): Promise<void> {
    const existing = await this.prisma.client.insured.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Insured not found');
    await this.prisma.withTenant((tx) =>
      tx.insured.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'cancelled' },
      }),
    );
  }

  /**
   * S3-09 — Encola un job de exportación de listado.
   *
   * Pipeline:
   *   1. Genera UUID exportId (no DB default — necesitamos retornarlo ya).
   *   2. INSERT en `exports` (status='pending') con el snapshot de filters.
   *   3. SQS message a reports-queue con {exportId, kind, filters, format,
   *      tenantId}. El worker hace pull, procesa, sube a S3 y actualiza la
   *      fila a 'ready'/'failed'.
   *   4. Audit log `data.export.requested` (action='export') con filters +
   *      rowCountEstimate. fire-and-forget.
   *
   * Tenant isolation: el INSERT pasa por `prisma.withTenant` (RLS aplica el
   * filtro). El audit usa el AuditWriter que es BYPASSRLS administrativo —
   * el `tenantId` se pasa explícito.
   *
   * Devolvemos `{exportId, status: 'pending'}` inmediatamente. El cliente
   * polea `GET /v1/exports/:id`.
   */
  async exportRequest(
    format: 'xlsx' | 'pdf',
    filters: ExportFilters,
    tenant: TenantCtx,
    actor: { id: string; ip?: string; userAgent?: string; traceId?: string },
  ): Promise<ExportRequestResult> {
    if (!this.sqs || !this.env) {
      throw new ForbiddenException('Export subsystem not available (SQS/Env not injected)');
    }

    const exportId = randomUUID();
    const filtersJson = filters as unknown as Prisma.InputJsonValue;

    // Persist primero, luego encolar. Si encolar falla, la fila pending
    // queda como evidencia operativa y el cliente recibe 500.
    await this.prisma.withTenant((tx) =>
      tx.export.create({
        data: {
          id: exportId,
          tenantId: tenant.id,
          requestedBy: actor.id,
          kind: EXPORT_KIND,
          format,
          filters: filtersJson,
          status: 'pending',
        },
      }),
    );

    try {
      await this.sqs.sendMessage(
        this.env.SQS_QUEUE_REPORTS,
        {
          kind: EXPORT_EVENT_KIND,
          exportId,
          tenantId: tenant.id,
          insuredKind: EXPORT_KIND,
          format,
          filters,
        },
      );
    } catch (err) {
      this.log.error(
        { err: err instanceof Error ? err.message : String(err), exportId },
        'export SQS enqueue failed; row queda en pending sin worker pickup',
      );
      throw err;
    }

    // Audit — acción `export`, payloadDiff con filters (sin PII; los filters
    // no contienen datos del individuo). Sin rowCountEstimate aquí: el
    // worker emite un audit `data.export.completed` con el rowCount real.
    if (this.auditWriter) {
      void this.auditWriter.record({
        tenantId: tenant.id,
        actorId: actor.id,
        action: 'export',
        resourceType: 'insureds',
        resourceId: exportId,
        ip: actor.ip,
        userAgent: actor.userAgent,
        traceId: actor.traceId,
        payloadDiff: {
          subAction: 'requested',
          format,
          filters: filters as unknown as Record<string, unknown>,
        },
      });
    }

    this.log.log({ exportId, tenantId: tenant.id, format }, 'export queued');
    return { exportId, status: 'pending' };
  }

  /**
   * S3-09 — Lookup por id del job de export. Filtra por `requestedBy=user.id`
   * para que cada user sólo vea sus propios exports (no leak inter-operador).
   *
   * Cuando `status='ready'`, calcula un presigned URL fresco (TTL 24h) en
   * cada llamada — NO persistimos la URL porque los presigneds AWS llevan
   * encoded el timestamp y queremos que cada poll devuelva una válida. El
   * S3 key sí está persistido y es estable.
   *
   * RLS: usa `prisma.client` (request-scoped, NOBYPASSRLS). Cross-tenant es
   * imposible aún si un atacante inyectara otro exportId en la URL — RLS
   * filtra y devuelve null → 404.
   */
  async findExport(
    exportId: string,
    tenant: TenantCtx,
    actor: { id: string },
  ): Promise<ExportStatusResponse> {
    if (!this.s3 || !this.env) {
      throw new ForbiddenException('Export subsystem not available (S3/Env not injected)');
    }
    const row = await this.prisma.client.export.findFirst({
      where: { id: exportId, requestedBy: actor.id },
    });
    // Anti-enumeration: si el id no existe (o es de otro user/tenant) → 404.
    if (!row) throw new NotFoundException('Export not found');
    if (row.tenantId !== tenant.id) throw new NotFoundException('Export not found');

    const out: ExportStatusResponse = {
      exportId: row.id,
      status: row.status,
      format: row.format as 'xlsx' | 'pdf',
      rowCount: row.rowCount,
      requestedAt: row.requestedAt.toISOString(),
      ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
      ...(row.hash ? { hash: row.hash } : {}),
      ...(row.error ? { error: row.error } : {}),
    };

    if (row.status === 'ready' && row.s3Key) {
      const url = await this.s3.getPresignedGetUrl(
        this.env.S3_BUCKET_EXPORTS,
        row.s3Key,
        EXPORT_DOWNLOAD_TTL_SECONDS,
      );
      out.downloadUrl = url;
      out.expiresAt = new Date(Date.now() + EXPORT_DOWNLOAD_TTL_SECONDS * 1000).toISOString();
    }
    return out;
  }

  /**
   * S3-09 / H-17 — Construye el WHERE compartido entre `list` y el worker de
   * export. Re-export delgado del builder compartido (`where-builder.ts`):
   * delega 100% del armado para que la equivalencia con `list` esté
   * garantizada por construcción (un sólo punto de modificación).
   *
   * NO incluye cursor/limit (export procesa todo).
   */
  buildExportWhere(filters: ExportFilters): Prisma.InsuredWhereInput {
    return buildInsuredsWhere(filters);
  }

  /** Hard cap exportable (anti-megacrayón PII). Re-export para tests. */
  static readonly EXPORT_ROW_HARD_CAP = EXPORT_ROW_HARD_CAP;
}

/**
 * Devuelve el resultado de un `Promise.allSettled` o `[]` si la query rejeó.
 * Loguea el motivo para no perder señales operativas. Usado por `find360`
 * para que un timeout puntual en una sección no derribe la respuesta entera.
 */
/**
 * Normaliza una Date a las 00:00:00.000 UTC del mismo día. Lo usamos en
 * `findSelf` para comparar `validTo` vs hoy en granularidad de día sin que
 * el delta arrastre horas/minutos (date-fns no está disponible en el
 * proyecto). Equivale conceptualmente a `differenceInCalendarDays`.
 */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function settled<T>(res: PromiseSettledResult<T[]>, label: string, log: Logger): T[] {
  if (res.status === 'fulfilled') return res.value;
  const reason = res.reason instanceof Error ? res.reason.message : String(res.reason);
  log.warn({ msg: `${label} rejected`, reason }, `${label} rejected`);
  return [];
}
