/**
 * S2-05 — ReportsService: KPIs reales + cache Redis.
 *
 * Cada KPI lee desde la BD via PrismaService (RLS-scoped). Para evitar
 * query storm bajo refresh frecuente del dashboard (60s polling x N usuarios),
 * envolvemos los métodos en un cache Redis con TTL 60s y keys
 * `dashboard:{tenantId}:{metric}`. La invalidación es por TTL — no
 * actualizamos en write porque las mutaciones que afectan KPIs (alta de
 * insured, emisión de cert, etc.) ya pasan por interceptors que podrían
 * publicar eventos; un job futuro puede hacer cache-invalidation puntual.
 *
 * Trend: % vs mismo período hace 30 días. Definición:
 *   trend = (currentValue - previousValue) / previousValue * 100
 *   Si previousValue == 0: trend = currentValue > 0 ? 100 : 0.
 *
 * Volumetry: 12 semanas hacia atrás, agrupado por ISO week (YYYY-Www).
 * Usamos `date_trunc('week', ...)` en SQL crudo (Prisma no soporta truncar
 * por week directamente en findMany).
 */
import { TenantCtx } from '@common/decorators/tenant.decorator';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { RedisService } from '@infra/cache/redis.service';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { ConciliacionData } from './dto/conciliacion-report.dto';
import type {
  DashboardKpi,
  DashboardResponse,
  RecentBatch,
  RecentCertificate,
  VolumetryWeek,
} from './dto/dashboard.dto';
import type { UtilizacionData, UtilizacionRow } from './dto/utilizacion-report.dto';
import type { VolumetriaData } from './dto/volumetria-report.dto';

const CACHE_TTL_SECONDS = 60;
const VOLUMETRY_WEEKS = 12;

/**
 * M2 — Scope polimórfico. Para superadmin (platformAdmin=true), agregamos
 * KPIs cross-tenant (o filtrados a un tenant específico si se pasa). El
 * cache key incluye el tenantId resuelto (o `_global_` cuando es null) para
 * que el agregado global no se mezcle con un tenant específico.
 */
export interface ReportsScope {
  platformAdmin: boolean;
  tenantId?: string;
  actorId?: string;
}

@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bypass: PrismaBypassRlsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Selecciona el cliente Prisma. Para platformAdmin → bypass (cross-tenant).
   * Logueamos cada uso del bypass para auditabilidad.
   */
  private clientFor(scope: ReportsScope): PrismaClient {
    if (scope.platformAdmin) {
      this.log.log(
        { msg: 'platform admin bypass', actor: scope.actorId ?? null, query: scope.tenantId ?? null },
        'platform admin bypass',
      );
      return this.bypass.client;
    }
    return this.prisma.client as unknown as PrismaClient;
  }

  /**
   * Cache key prefix por scope. Para superadmin sin tenantId el prefix es
   * `_global_` para no mezclar con caches por tenant específico.
   */
  private cacheTenantKey(scope: ReportsScope): string {
    if (scope.platformAdmin) {
      return scope.tenantId ?? '_global_';
    }
    return scope.tenantId ?? 'unknown';
  }

  // ---- legacy stub endpoints (S2-05 → S4-01..03 implemented below) -------
  /** Mantenidos sólo como compatibilidad de los stubs Sprint 0; los caller
   *  reales son `getConciliacionReport`, `getVolumetria90`, `getUtilizacion`. */
  conciliation(): never {
    throw new Error('ReportsService.conciliation legacy stub — usar getConciliacionReport');
  }
  volumetry(): never {
    throw new Error('ReportsService.volumetry legacy stub — usar getVolumetrySeries / getVolumetria90');
  }
  usage(): never {
    throw new Error('ReportsService.usage legacy stub — usar getUtilizacion');
  }
  schedule(): never {
    throw new Error('ReportsService.schedule pending');
  }

  // ---- S4-01 conciliación mensual ----------------------------------------
  /**
   * Reporte de conciliación entre dos fechas. Cifras DEBEN cuadrar con BD:
   *   activosInicio  = COUNT(insureds activos cuyo createdAt < from
   *                    AND (deletedAt IS NULL OR deletedAt >= from)
   *                    AND (status != 'cancelled' o updatedAt >= from))
   *   activosCierre  = COUNT(insureds activos al final del día `to`)
   *   altas          = COUNT(insureds.createdAt en [from, to])
   *   bajas          = COUNT(insureds.status='cancelled' AND updatedAt en [from, to])
   *   certs          = COUNT(certificates.issuedAt en [from, to] AND deletedAt IS NULL)
   *   claims         = COUNT(claims.reportedAt en [from, to])
   *   claimsAmount*  = SUM amount_estimated/approved en el mismo set
   *   coverageUsage  = COUNT + SUM amount de coverage_usage.usedAt en [from, to]
   *
   * Cache: 5 min (TTL razonable; el reporte es histórico cuando from/to está
   * en pasado). Para período "open" (`to` futuro o hoy), el cache podría
   * estar stale hasta 5 min — aceptable para reporting mensual.
   */
  async getConciliacionReport(from: string, to: string, scope: ReportsScope): Promise<ConciliacionData> {
    const cacheKey = `report:conciliacion:${this.cacheTenantKey(scope)}:${from}:${to}`;
    return this.cached(
      cacheKey,
      async () => {
        const client = this.clientFor(scope);
        const fromDate = new Date(`${from}T00:00:00.000Z`);
        // Inclusive end-of-day para `to`.
        const toDate = new Date(`${to}T23:59:59.999Z`);
        const tenantWhere = scope.platformAdmin && scope.tenantId ? { tenantId: scope.tenantId } : {};

        const [
          activosInicio,
          activosCierre,
          altas,
          bajas,
          certificadosEmitidos,
          claimsAgg,
          coverageUsageAgg,
        ] = await Promise.all([
          // Activos al inicio: createdAt < from AND (no deleted before from) AND (not cancelled before from).
          client.insured.count({
            where: {
              ...tenantWhere,
              createdAt: { lt: fromDate },
              OR: [{ deletedAt: null }, { deletedAt: { gte: fromDate } }],
              NOT: {
                AND: [{ status: 'cancelled' }, { updatedAt: { lt: fromDate } }],
              },
            },
          }),
          // Activos al cierre: status='active' AND createdAt <= to AND deletedAt IS NULL.
          client.insured.count({
            where: {
              ...tenantWhere,
              status: 'active',
              deletedAt: null,
              createdAt: { lte: toDate },
            },
          }),
          // Altas: createdAt en [from, to].
          client.insured.count({
            where: { ...tenantWhere, createdAt: { gte: fromDate, lte: toDate } },
          }),
          // Bajas: cancelled con updatedAt en [from, to].
          client.insured.count({
            where: {
              ...tenantWhere,
              status: 'cancelled',
              updatedAt: { gte: fromDate, lte: toDate },
            },
          }),
          // Certs emitidos en período.
          client.certificate.count({
            where: {
              ...tenantWhere,
              deletedAt: null,
              issuedAt: { gte: fromDate, lte: toDate },
            },
          }),
          // Claims agregados.
          client.claim.aggregate({
            _count: { _all: true },
            _sum: { amountEstimated: true, amountApproved: true },
            where: {
              ...tenantWhere,
              deletedAt: null,
              reportedAt: { gte: fromDate, lte: toDate },
            },
          }),
          // Coverage usage agregados.
          client.coverageUsage.aggregate({
            _count: { _all: true },
            _sum: { amount: true },
            where: { ...tenantWhere, usedAt: { gte: fromDate, lte: toDate } },
          }),
        ]);

        return {
          from,
          to,
          tenantId: scope.platformAdmin && !scope.tenantId ? null : (scope.tenantId ?? null),
          activosInicio,
          activosCierre,
          altas,
          bajas,
          certificadosEmitidos,
          claimsCount: claimsAgg._count._all,
          claimsAmountEstimated: decimalToNumber(claimsAgg._sum.amountEstimated),
          claimsAmountApproved: decimalToNumber(claimsAgg._sum.amountApproved),
          coverageUsageCount: coverageUsageAgg._count._all,
          coverageUsageAmount: decimalToNumber(coverageUsageAgg._sum.amount),
          generatedAt: new Date().toISOString(),
        };
      },
      300,
    );
  }

  // ---- S4-02 volumetría 90 días ------------------------------------------
  /**
   * Trend diario en ventana [hoy - days, hoy] con métricas agregadas:
   *   altas, bajas, certificados, claims.
   *
   * Single SQL crudo usando `date_trunc('day', ...)` — Prisma no soporta
   * `groupBy` en truncamiento de fecha sin extra wiring. 4 queries en
   * paralelo (una por métrica) + relleno de buckets vacíos.
   *
   * Cache: 60s (matches dashboard volumetry behaviour).
   */
  async getVolumetria90(days: number, scope: ReportsScope): Promise<VolumetriaData> {
    const cacheKey = `report:volumetria:${this.cacheTenantKey(scope)}:${days}d`;
    return this.cached(cacheKey, async () => {
      const client = this.clientFor(scope);
      const now = new Date();
      const toDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
      );
      const fromDate = new Date(toDate.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
      fromDate.setUTCHours(0, 0, 0, 0);

      const tenantFilter =
        scope.platformAdmin && scope.tenantId
          ? Prisma.sql`AND tenant_id = ${scope.tenantId}::uuid `
          : Prisma.sql``;
      const fromIso = fromDate.toISOString();
      const toIso = toDate.toISOString();

      const [altas, bajas, certs, claims] = await Promise.all([
        client.$queryRaw<Array<{ day: Date; n: bigint }>>(
          Prisma.sql`SELECT date_trunc('day', created_at) AS day, COUNT(*)::bigint AS n
                     FROM insureds
                     WHERE created_at >= ${fromIso}::timestamp AND created_at <= ${toIso}::timestamp
                       AND deleted_at IS NULL ${tenantFilter}
                     GROUP BY 1 ORDER BY 1`,
        ),
        client.$queryRaw<Array<{ day: Date; n: bigint }>>(
          Prisma.sql`SELECT date_trunc('day', updated_at) AS day, COUNT(*)::bigint AS n
                     FROM insureds
                     WHERE updated_at >= ${fromIso}::timestamp AND updated_at <= ${toIso}::timestamp
                       AND status = 'cancelled' ${tenantFilter}
                     GROUP BY 1 ORDER BY 1`,
        ),
        client.$queryRaw<Array<{ day: Date; n: bigint }>>(
          Prisma.sql`SELECT date_trunc('day', issued_at) AS day, COUNT(*)::bigint AS n
                     FROM certificates
                     WHERE issued_at >= ${fromIso}::timestamp AND issued_at <= ${toIso}::timestamp
                       AND deleted_at IS NULL ${tenantFilter}
                     GROUP BY 1 ORDER BY 1`,
        ),
        client.$queryRaw<Array<{ day: Date; n: bigint }>>(
          Prisma.sql`SELECT date_trunc('day', reported_at) AS day, COUNT(*)::bigint AS n
                     FROM claims
                     WHERE reported_at >= ${fromIso}::timestamp AND reported_at <= ${toIso}::timestamp
                       AND deleted_at IS NULL ${tenantFilter}
                     GROUP BY 1 ORDER BY 1`,
        ),
      ]);

      const altasMap = new Map(altas.map((r) => [dayKey(r.day), Number(r.n)]));
      const bajasMap = new Map(bajas.map((r) => [dayKey(r.day), Number(r.n)]));
      const certsMap = new Map(certs.map((r) => [dayKey(r.day), Number(r.n)]));
      const claimsMap = new Map(claims.map((r) => [dayKey(r.day), Number(r.n)]));

      const points: VolumetriaData['points'] = [];
      for (let i = 0; i < days; i += 1) {
        const d = new Date(fromDate.getTime() + i * 24 * 60 * 60 * 1000);
        const k = dayKey(d);
        points.push({
          date: k,
          altas: altasMap.get(k) ?? 0,
          bajas: bajasMap.get(k) ?? 0,
          certificados: certsMap.get(k) ?? 0,
          claims: claimsMap.get(k) ?? 0,
        });
      }

      return {
        days,
        from: dayKey(fromDate),
        to: dayKey(toDate),
        points,
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ---- S4-03 utilización por cobertura -----------------------------------
  /**
   * Top-N consumidores agregados por (paquete × cobertura) en el período,
   * + agregado por paquete (sin LIMIT) para gráfico stack del FE.
   *
   * Cache: 5 min.
   */
  async getUtilizacion(
    from: string,
    to: string,
    topN: number,
    scope: ReportsScope,
    /**
     * S1 iter 2 — Filtro opcional por paquete. Cuando está presente,
     * restringe el `findMany(coverages)` a `packageId = X`; los rows
     * cuyos `coverageId` no caen en ese paquete se descartan después
     * del groupBy. El `byPackage` también queda con un solo bucket.
     * Es UUID validado en el DTO (no inyectable).
     */
    packageId?: string,
  ): Promise<UtilizacionData> {
    const cacheKey = `report:utilizacion:${this.cacheTenantKey(scope)}:${from}:${to}:${topN}:${packageId ?? '_all_'}`;
    return this.cached(
      cacheKey,
      async () => {
        const client = this.clientFor(scope);
        const fromDate = new Date(`${from}T00:00:00.000Z`);
        const toDate = new Date(`${to}T23:59:59.999Z`);
        const tenantWhere = scope.platformAdmin && scope.tenantId ? { tenantId: scope.tenantId } : {};

        // Group by coverageId — Prisma no permite groupBy con joins, así
        // que hacemos groupBy + lookup paralelo de coverages/packages.
        const grouped = await client.coverageUsage.groupBy({
          by: ['coverageId'],
          _count: { _all: true },
          _sum: { amount: true },
          where: { ...tenantWhere, usedAt: { gte: fromDate, lte: toDate } },
        });

        if (grouped.length === 0) {
          return {
            from,
            to,
            topN,
            rows: [],
            byPackage: [],
            generatedAt: new Date().toISOString(),
          };
        }

        const coverageIds = grouped.map((g) => g.coverageId);
        // El filtro `packageId` se aplica acá: si vino, sólo trae las
        // coverages que pertenecen a ese paquete; las groupBy rows cuyos
        // coverageId no estén en este set caerán en el `.filter(null)`
        // del map de abajo (semántica equivalente a un INNER JOIN).
        const coverages = await client.coverage.findMany({
          where: {
            id: { in: coverageIds },
            ...tenantWhere,
            ...(packageId ? { packageId } : {}),
          },
          include: { package: { select: { id: true, name: true } } },
        });
        const covById = new Map(coverages.map((c) => [c.id, c]));

        const rows: UtilizacionRow[] = grouped
          .map((g): UtilizacionRow | null => {
            const cov = covById.get(g.coverageId);
            if (!cov) return null;
            return {
              packageId: cov.package.id,
              packageName: cov.package.name,
              coverageId: cov.id,
              coverageName: cov.name,
              coverageType: String(cov.type),
              usageCount: g._count._all,
              usageAmount: decimalToNumber(g._sum.amount),
            };
          })
          .filter((r): r is UtilizacionRow => r !== null)
          .sort((a, b) => b.usageAmount - a.usageAmount || b.usageCount - a.usageCount);

        const top = rows.slice(0, topN);

        const byPackageMap = new Map<string, { name: string; count: number; amount: number }>();
        for (const r of rows) {
          const cur = byPackageMap.get(r.packageId) ?? { name: r.packageName, count: 0, amount: 0 };
          cur.count += r.usageCount;
          cur.amount += r.usageAmount;
          byPackageMap.set(r.packageId, cur);
        }
        const byPackage = Array.from(byPackageMap.entries())
          .map(([id, v]) => ({
            packageId: id,
            packageName: v.name,
            totalUsageCount: v.count,
            totalUsageAmount: v.amount,
          }))
          .sort((a, b) => b.totalUsageAmount - a.totalUsageAmount);

        return {
          from,
          to,
          topN,
          rows: top,
          byPackage,
          generatedAt: new Date().toISOString(),
        };
      },
      300,
    );
  }
  // -------------------------------------------------------------------------

  /**
   * Lectura del dashboard. Acepta dos shapes:
   *   - `TenantCtx` (path legacy, tenant-scoped): equivale a scope con
   *     `platformAdmin=false`.
   *   - `ReportsScope` (path M2): superadmin (platformAdmin=true) puede pedir
   *     agregado global o filtrar por tenantId.
   */
  async getDashboard(arg: TenantCtx | ReportsScope): Promise<DashboardResponse> {
    const scope: ReportsScope = isScope(arg) ? arg : { platformAdmin: false, tenantId: arg.id };

    const [activeInsureds, certificates30d, claims30d, coverageConsumedPct, volumetry] = await Promise.all([
      this.getActiveInsuredsCount(scope),
      this.getCertificatesIssued30d(scope),
      this.getClaims30d(scope),
      this.getCoverageConsumedPct(scope),
      this.getVolumetrySeries(scope),
    ]);

    const [recentBatches, recentCertificates] = await Promise.all([
      this.getRecentBatches(scope),
      this.getRecentCertificates(scope),
    ]);

    return {
      kpis: {
        activeInsureds,
        certificates30d,
        claims30d,
        coverageConsumedPct,
      },
      volumetry,
      recentBatches,
      recentCertificates,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * KPI: insureds activos. Acepta `tenantId: string` (back-compat tests) o
   * `ReportsScope` (M2). Cuando recibe string, asume path RLS tenant-scoped.
   */
  async getActiveInsuredsCount(arg: string | ReportsScope): Promise<DashboardKpi> {
    const scope: ReportsScope = typeof arg === 'string' ? { platformAdmin: false, tenantId: arg } : arg;
    const cacheKey = `dashboard:${this.cacheTenantKey(scope)}:activeInsureds`;
    const client = this.clientFor(scope);
    return this.cached(cacheKey, async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const tenantWhere = scope.platformAdmin && scope.tenantId ? { tenantId: scope.tenantId } : {};
      const [current, previous] = await Promise.all([
        client.insured.count({
          where: { status: 'active', deletedAt: null, ...tenantWhere },
        }),
        client.insured.count({
          where: {
            status: 'active',
            deletedAt: null,
            createdAt: { lte: thirtyDaysAgo },
            ...tenantWhere,
          },
        }),
      ]);
      return { value: current, trend: pctChange(current, previous) };
    });
  }

  async getCertificatesIssued30d(arg: string | ReportsScope): Promise<DashboardKpi> {
    const scope: ReportsScope = typeof arg === 'string' ? { platformAdmin: false, tenantId: arg } : arg;
    const cacheKey = `dashboard:${this.cacheTenantKey(scope)}:certificates30d`;
    const client = this.clientFor(scope);
    return this.cached(cacheKey, async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const tenantWhere = scope.platformAdmin && scope.tenantId ? { tenantId: scope.tenantId } : {};
      const [current, previous] = await Promise.all([
        client.certificate.count({
          where: { issuedAt: { gte: thirtyDaysAgo }, deletedAt: null, ...tenantWhere },
        }),
        client.certificate.count({
          where: {
            issuedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
            deletedAt: null,
            ...tenantWhere,
          },
        }),
      ]);
      return { value: current, trend: pctChange(current, previous) };
    });
  }

  async getClaims30d(arg: string | ReportsScope): Promise<DashboardKpi> {
    const scope: ReportsScope = typeof arg === 'string' ? { platformAdmin: false, tenantId: arg } : arg;
    const cacheKey = `dashboard:${this.cacheTenantKey(scope)}:claims30d`;
    const client = this.clientFor(scope);
    return this.cached(cacheKey, async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const tenantWhere = scope.platformAdmin && scope.tenantId ? { tenantId: scope.tenantId } : {};
      const [current, previous] = await Promise.all([
        client.claim.count({
          where: { reportedAt: { gte: thirtyDaysAgo }, deletedAt: null, ...tenantWhere },
        }),
        client.claim.count({
          where: {
            reportedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
            deletedAt: null,
            ...tenantWhere,
          },
        }),
      ]);
      return { value: current, trend: pctChange(current, previous) };
    });
  }

  async getCoverageConsumedPct(arg: string | ReportsScope): Promise<DashboardKpi> {
    const scope: ReportsScope = typeof arg === 'string' ? { platformAdmin: false, tenantId: arg } : arg;
    const cacheKey = `dashboard:${this.cacheTenantKey(scope)}:coverageConsumedPct`;
    const client = this.clientFor(scope);
    return this.cached(cacheKey, async () => {
      // Promedio de consumo = sum(usages count or amount) / sum(limit) por
      // cada coverage activa, ponderado por número de coverages.
      const tenantWhere = scope.platformAdmin && scope.tenantId ? { tenantId: scope.tenantId } : {};
      const coverages = await client.coverage.findMany({
        where: { deletedAt: null, ...tenantWhere },
        select: {
          id: true,
          limitCount: true,
          limitAmount: true,
          _count: { select: { usages: true } },
        },
      });
      if (coverages.length === 0) return { value: 0, trend: 0 };
      const usageRows = await client.coverageUsage.groupBy({
        by: ['coverageId'],
        _sum: { amount: true },
        _count: { _all: true },
      });
      const usageById = new Map<string, { usedCount: number; usedAmount: number }>();
      for (const row of usageRows) {
        usageById.set(row.coverageId, {
          usedCount: row._count._all,
          usedAmount: row._sum.amount === null ? 0 : Number(row._sum.amount),
        });
      }
      let totalPct = 0;
      let counted = 0;
      for (const c of coverages) {
        const u = usageById.get(c.id) ?? { usedCount: 0, usedAmount: 0 };
        let pct: number | null = null;
        if (c.limitCount && c.limitCount > 0) {
          pct = (u.usedCount / c.limitCount) * 100;
        } else if (c.limitAmount && Number(c.limitAmount) > 0) {
          pct = (u.usedAmount / Number(c.limitAmount)) * 100;
        }
        if (pct !== null) {
          totalPct += Math.min(pct, 100);
          counted += 1;
        }
      }
      const value = counted === 0 ? 0 : Math.round(totalPct / counted);
      return { value, trend: 0 };
    });
  }

  /**
   * Series temporales por semana últimas 12 semanas.
   * Una sola query SQL crudo agrupa por week + métrica.
   * Devuelve siempre las 12 buckets — los faltantes se rellenan con 0.
   */
  async getVolumetrySeries(arg: string | ReportsScope): Promise<VolumetryWeek[]> {
    const scope: ReportsScope = typeof arg === 'string' ? { platformAdmin: false, tenantId: arg } : arg;
    const cacheKey = `dashboard:${this.cacheTenantKey(scope)}:volumetry`;
    const client = this.clientFor(scope);
    return this.cached(cacheKey, async () => {
      const now = new Date();
      const startDate = new Date(now);
      startDate.setUTCDate(startDate.getUTCDate() - VOLUMETRY_WEEKS * 7);
      const startIso = startDate.toISOString();

      // Para superadmin con tenantId filter, agregamos AND tenant_id = ...
      // Para platformAdmin sin tenantId: agregado global.
      // Para path RLS: las policies filtran automáticamente.
      const tenantFilter =
        scope.platformAdmin && scope.tenantId
          ? Prisma.sql`AND tenant_id = ${scope.tenantId}::uuid `
          : Prisma.sql``;

      // Altas: insureds.created_at; Bajas: insureds donde status='cancelled'
      // con updated_at en la semana; Certs: certificates.issued_at.
      const altas = await client.$queryRaw<Array<{ week: Date; n: bigint }>>(
        Prisma.sql`SELECT date_trunc('week', created_at) AS week, COUNT(*)::bigint AS n
                   FROM insureds
                   WHERE created_at >= ${startIso}::timestamp AND deleted_at IS NULL ${tenantFilter}
                   GROUP BY 1 ORDER BY 1`,
      );
      const bajas = await client.$queryRaw<Array<{ week: Date; n: bigint }>>(
        Prisma.sql`SELECT date_trunc('week', updated_at) AS week, COUNT(*)::bigint AS n
                   FROM insureds
                   WHERE updated_at >= ${startIso}::timestamp AND status = 'cancelled' ${tenantFilter}
                   GROUP BY 1 ORDER BY 1`,
      );
      const certs = await client.$queryRaw<Array<{ week: Date; n: bigint }>>(
        Prisma.sql`SELECT date_trunc('week', issued_at) AS week, COUNT(*)::bigint AS n
                   FROM certificates
                   WHERE issued_at >= ${startIso}::timestamp AND deleted_at IS NULL ${tenantFilter}
                   GROUP BY 1 ORDER BY 1`,
      );

      const altasMap = new Map(altas.map((r) => [iso(r.week), Number(r.n)]));
      const bajasMap = new Map(bajas.map((r) => [iso(r.week), Number(r.n)]));
      const certsMap = new Map(certs.map((r) => [iso(r.week), Number(r.n)]));

      const out: VolumetryWeek[] = [];
      for (let i = VOLUMETRY_WEEKS - 1; i >= 0; i -= 1) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - i * 7);
        // Trunc a lunes UTC para alinear con date_trunc('week').
        const monday = mondayUtc(d);
        const key = iso(monday);
        out.push({
          week: isoWeekLabel(monday),
          altas: altasMap.get(key) ?? 0,
          bajas: bajasMap.get(key) ?? 0,
          certs: certsMap.get(key) ?? 0,
        });
      }
      return out;
    });
  }

  private async getRecentBatches(scope: ReportsScope): Promise<RecentBatch[]> {
    const client = this.clientFor(scope);
    const where: { deletedAt: null; tenantId?: string } = { deletedAt: null };
    if (scope.platformAdmin && scope.tenantId) where.tenantId = scope.tenantId;
    const rows = await client.batch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        fileName: true,
        rowsTotal: true,
        status: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      rowsTotal: r.rowsTotal,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async getRecentCertificates(scope: ReportsScope): Promise<RecentCertificate[]> {
    const client = this.clientFor(scope);
    const where: { deletedAt: null; tenantId?: string } = { deletedAt: null };
    if (scope.platformAdmin && scope.tenantId) where.tenantId = scope.tenantId;
    const rows = await client.certificate.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      take: 5,
      include: {
        insured: { select: { fullName: true, package: { select: { name: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      insuredFullName: r.insured.fullName,
      packageName: r.insured.package?.name ?? '',
      issuedAt: r.issuedAt.toISOString(),
    }));
  }

  /** Cache wrapper Redis con TTL configurable (default 60s). */
  private async cached<T>(
    key: string,
    compute: () => Promise<T>,
    ttlSeconds = CACHE_TTL_SECONDS,
  ): Promise<T> {
    try {
      const hit = await this.redis.get(key);
      if (hit) {
        return JSON.parse(hit) as T;
      }
    } catch (err) {
      this.log.warn({ err: (err as Error).message, key }, 'redis.get failed; falling back');
    }
    const value = await compute();
    try {
      await this.redis.set(key, JSON.stringify(value), ttlSeconds);
    } catch (err) {
      this.log.warn({ err: (err as Error).message, key }, 'redis.set failed; result not cached');
    }
    return value;
  }
}

/** Convierte `Prisma.Decimal | null` (o number | null) a number con default 0. */
function decimalToNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  // Prisma Decimal objects tienen toNumber(); fallback a Number(v).
  const maybe = v as { toNumber?: () => number };
  if (typeof maybe.toNumber === 'function') return maybe.toNumber();
  return Number(v);
}

/** Devuelve `YYYY-MM-DD` UTC sin parsear locale. */
function dayKey(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

function isScope(arg: TenantCtx | ReportsScope): arg is ReportsScope {
  return typeof (arg as ReportsScope).platformAdmin === 'boolean';
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100 * 10) / 10;
}

function iso(d: Date): string {
  return new Date(d).toISOString();
}

function mondayUtc(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = out.getUTCDay();
  // PostgreSQL date_trunc('week', x) usa lunes como inicio (ISO).
  // En JS getUTCDay devuelve 0=domingo, 1=lunes, ...
  const offset = day === 0 ? -6 : 1 - day;
  out.setUTCDate(out.getUTCDate() + offset);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function isoWeekLabel(d: Date): string {
  // ISO week label YYYY-Www. Usamos un cálculo determinístico simple.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
