/**
 * H-17 — Where-builder compartido para `Insured`.
 *
 * Antes: el bloque `where.OR = [...]` con la búsqueda fuzzy en
 *   - `fullName`            (ILIKE %term% case-insensitive)
 *   - `curp`                (ILIKE %TERM% upper)
 *   - `rfc`                 (ILIKE %TERM% upper)
 *   - `metadata.numeroEmpleadoExterno` (JSON path string_contains)
 *
 * más los rangos `validFrom`/`validTo` y los eq filters (`status`, `packageId`)
 * estaba **triplicado byte-idéntico** en 3 sites:
 *
 *   1. `InsuredsService.list`             (controller list path, RLS request-scoped)
 *   2. `InsuredsService.buildExportWhere` (export request handler)
 *   3. `ReportsWorkerService.queryInsureds` (background worker, BYPASSRLS)
 *
 * El audit `docs/audit/05-insureds-reports-v2.md §A5-06` confirmó la
 * triplicación y proyectó que cualquier filtro nuevo (p.ej. `entidad`)
 * tocaría sólo UN lugar y rompería la equivalencia listado-vs-export. El
 * test `insureds.service.spec.ts:66-81` valida `or[0]` y `or[3]` por
 * orden — un drift de 4 → 5 elementos en `list` no detecta la divergencia
 * worker↔service.
 *
 * Esta función es la **fuente única**:
 *   - Mismo type para los 3 callers (`Prisma.InsuredWhereInput`).
 *   - Acepta una intersección laxa `InsuredsWhereFilter` que cubre tanto
 *     `ListInsuredsQuery` como `ExportFilters` (zod-inferidos) — los dos
 *     comparten la misma forma de filtros de búsqueda.
 *   - NO incluye `tenantId`/cursor/limit: cada caller resuelve eso a su
 *     nivel (RLS path en el service, filter explícito en el worker).
 *
 * Si en el futuro hay que agregar un campo de búsqueda nuevo (story C bug
 * fix Sprint 4+), **se modifica AQUÍ y los 3 sites quedan en sync sin
 * intervención adicional**. Tests del módulo `where-builder.spec.ts` cubren
 * cada filtro independientemente.
 */
import { Prisma } from '@prisma/client';

/**
 * Subconjunto laxo del filtro shared entre `ListInsuredsQuery` y
 * `ExportFilters`. Se acepta `string` para fechas porque ambos schemas Zod
 * las exponen como ISO strings post-parse.
 */
export interface InsuredsWhereFilter {
  q?: string;
  status?: string;
  packageId?: string;
  validFromGte?: string;
  validFromLte?: string;
  validToGte?: string;
  validToLte?: string;
}

/**
 * Construye el `Prisma.InsuredWhereInput` compartido. Caller-scoped flags
 * (tenantId, cursor, deletedAt si difiere) los aplica el caller después.
 *
 * Convención: incluimos `deletedAt: null` por default — los 3 sites lo
 * tenían y el filtro soft-delete es cross-cutting. Si algún path quiere
 * incluir filas eliminadas debe ignorar este builder o sobrescribir el campo.
 */
export function buildInsuredsWhere(filter: InsuredsWhereFilter): Prisma.InsuredWhereInput {
  const where: Prisma.InsuredWhereInput = { deletedAt: null };

  if (filter.status) where.status = filter.status as Prisma.InsuredWhereInput['status'];
  if (filter.packageId) where.packageId = filter.packageId;

  if (filter.q) {
    const term = filter.q.trim();
    where.OR = [
      { fullName: { contains: term, mode: 'insensitive' } },
      { curp: { contains: term.toUpperCase() } },
      { rfc: { contains: term.toUpperCase() } },
      {
        metadata: {
          path: ['numeroEmpleadoExterno'],
          string_contains: term,
        },
      },
    ];
  }

  const validFromRange: { gte?: Date; lte?: Date } = {};
  if (filter.validFromGte) validFromRange.gte = new Date(filter.validFromGte);
  if (filter.validFromLte) validFromRange.lte = new Date(filter.validFromLte);
  if (Object.keys(validFromRange).length > 0) where.validFrom = validFromRange;

  const validToRange: { gte?: Date; lte?: Date } = {};
  if (filter.validToGte) validToRange.gte = new Date(filter.validToGte);
  if (filter.validToLte) validToRange.lte = new Date(filter.validToLte);
  if (Object.keys(validToRange).length > 0) where.validTo = validToRange;

  return where;
}
