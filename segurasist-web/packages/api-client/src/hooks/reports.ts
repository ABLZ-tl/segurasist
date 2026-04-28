import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { qs } from '../qs';
import type { ReportRange } from '../types';

/**
 * S4-01/02/03 — Hooks Reports.
 *
 * Tres dominios:
 *  - **Conciliación** (`useConciliacionReport`): preview tabular del reporte
 *    mensual filtrado por rango de fechas + entidad opcional. El download
 *    binario se hace con `useDownloadReport` (PDF/XLSX).
 *  - **Volumetría** (`useVolumetria`): serie diaria de altas/bajas/certs en
 *    los últimos N días (default 90) — alimenta el line chart S4-02.
 *  - **Utilización** (`useUtilizacion`): Top-N por cobertura, alimenta el bar
 *    chart S4-03.
 *
 * Coordinación con S1: shapes ESPERADAS al cierre de iter1 (DTOs en BE no
 * publicados aún en feed). NEW-FINDING en feed si difieren post-iter1 S1.
 *
 * Compatibilidad: los exports legacy (`useVolumetry`, `useUsage`,
 * `useGenerateMonthlyReconciliation`) se mantienen para no romper
 * consumidores existentes; quedan deprecated y se eliminan en Sprint 5.
 */

// ─── Tipos compartidos ──────────────────────────────────────────────────────

export interface VolumetryPoint {
  date: string;
  metric: string;
  value: number;
}

export interface UsageRow {
  packageId: string;
  packageName: string;
  coverageId: string;
  coverageName: string;
  used: number;
  limit: number;
}

// ─── S4-01 — Conciliación ───────────────────────────────────────────────────

export interface ConciliacionFilters {
  /** ISO date `YYYY-MM-DD`. */
  from: string;
  /** ISO date `YYYY-MM-DD`. */
  to: string;
  /**
   * Filtro por tenant (solo platform admin / superadmin). Si se omite y el
   * usuario es platform admin, el reporte es agregado global.
   */
  tenantId?: string;
}

/**
 * Shape exacta del BE (S1) — `ReportsService.getConciliacionReport`.
 * El reporte mensual NO devuelve filas; devuelve un único objeto con totales
 * agregados para el período. El FE renderiza esto como grid de stats + dos
 * botones de descarga (PDF/XLSX).
 */
export interface ConciliacionReportResponse {
  from: string;
  to: string;
  /** `null` cuando platformAdmin agregado sin filtro tenant. */
  tenantId: string | null;
  activosInicio: number;
  activosCierre: number;
  altas: number;
  bajas: number;
  certificadosEmitidos: number;
  claimsCount: number;
  claimsAmountEstimated: number;
  claimsAmountApproved: number;
  coverageUsageCount: number;
  coverageUsageAmount: number;
  generatedAt: string;
}

// ─── S4-02 — Volumetría ────────────────────────────────────────────────────

/**
 * Punto diario de la volumetría (line chart 90 días).
 * Shape exacta del BE (S1) — `ReportsService.getVolumetria90`.
 */
export interface VolumetriaPoint {
  /** ISO date `YYYY-MM-DD`. */
  date: string;
  altas: number;
  bajas: number;
  certificados: number;
  claims: number;
}

export interface VolumetriaResponse {
  days: number;
  from: string;
  to: string;
  points: VolumetriaPoint[];
  generatedAt: string;
}

// ─── S4-03 — Utilización ───────────────────────────────────────────────────

export interface UtilizacionFilters {
  /** ISO date `YYYY-MM-DD`. */
  from: string;
  /** ISO date `YYYY-MM-DD`. */
  to: string;
  /** Top-N (default 10, range typical [5..50]). */
  topN?: number;
  /** Solo platformAdmin: tenantId override. */
  tenantId?: string;
}

/**
 * Fila por cobertura para bar chart Top-N (S4-03).
 * Shape exacta del BE (S1) — `ReportsService.getUtilizacion`.
 */
export interface UtilizacionRow {
  packageId: string;
  packageName: string;
  coverageId: string;
  coverageName: string;
  /** 'count' | 'amount' (depende del schema). */
  coverageType: string;
  /** Cantidad de eventos de uso (registros en `coverage_usage`). */
  usageCount: number;
  /** Suma del campo `amount` de los eventos (Decimal → number). */
  usageAmount: number;
}

/** Agregado por paquete (sin LIMIT) para gráfico stack. */
export interface UtilizacionByPackage {
  packageId: string;
  packageName: string;
  totalUsageCount: number;
  totalUsageAmount: number;
}

export interface UtilizacionResponse {
  from: string;
  to: string;
  topN: number;
  rows: UtilizacionRow[];
  byPackage: UtilizacionByPackage[];
  generatedAt: string;
}

// ─── Query keys ─────────────────────────────────────────────────────────────

export const reportsKeys = {
  // legacy
  volumetry: (range: ReportRange) => ['reports', 'volumetry', range] as const,
  usage: (packageId?: string) => ['reports', 'usage', packageId] as const,
  // S4
  conciliacion: (filters: ConciliacionFilters) => ['reports', 'conciliacion', filters] as const,
  volumetria: (days: number) => ['reports', 'volumetria', days] as const,
  utilizacion: (filters: UtilizacionFilters) => ['reports', 'utilizacion', filters] as const,
};

// ─── Legacy hooks (compat, deprecated en Sprint 5) ──────────────────────────

/** @deprecated S4-02 — usar `useVolumetria(days)`. */
export const useVolumetry = (range: ReportRange) =>
  useQuery({
    queryKey: reportsKeys.volumetry(range),
    queryFn: () => api<VolumetryPoint[]>(`/v1/reports/volumetry?${qs(range)}`),
    staleTime: 5 * 60_000,
  });

/** @deprecated S4-03 — usar `useUtilizacion(filters)`. */
export const useUsage = (packageId?: string) =>
  useQuery({
    queryKey: reportsKeys.usage(packageId),
    queryFn: () => api<UsageRow[]>(`/v1/reports/usage?${qs({ packageId })}`),
    staleTime: 5 * 60_000,
  });

/** @deprecated S4-01 — usar `useDownloadReport({type:'conciliacion', format:'pdf', filters})`. */
export const useGenerateMonthlyReconciliation = () =>
  useMutation({
    mutationFn: (params: { month: string; entityId: string }) =>
      api<{ url: string }>('/v1/reports/reconciliation', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  });

// ─── S4-01 — Conciliación preview ───────────────────────────────────────────

/**
 * Preview tabular del reporte de conciliación. NO descarga binario; solo
 * agregados que el BE devuelve en JSON. La descarga se hace con
 * `useDownloadReport({type:'conciliacion', format:'pdf'|'xlsx'})`.
 */
export const useConciliacionReport = (filters: ConciliacionFilters) =>
  useQuery({
    queryKey: reportsKeys.conciliacion(filters),
    queryFn: () => api<ConciliacionReportResponse>(`/v1/reports/conciliacion?${qs(filters)}`),
    enabled: Boolean(filters.from && filters.to),
    staleTime: 60_000,
  });

// ─── S4-02 — Volumetría 90d ─────────────────────────────────────────────────

/**
 * Trend volumetría diario para line chart. Default 90 días — el BE puede
 * retornar menos puntos si el tenant es nuevo (los gaps se rellenan en
 * frontend si es necesario; iter 2 si hace falta).
 */
export const useVolumetria = (days = 90) =>
  useQuery({
    queryKey: reportsKeys.volumetria(days),
    queryFn: () => api<VolumetriaResponse>(`/v1/reports/volumetria?${qs({ days })}`),
    staleTime: 5 * 60_000,
  });

// ─── S4-03 — Utilización Top-N ──────────────────────────────────────────────

export const useUtilizacion = (filters: UtilizacionFilters) =>
  useQuery({
    queryKey: reportsKeys.utilizacion(filters),
    queryFn: () => api<UtilizacionResponse>(`/v1/reports/utilizacion?${qs(filters)}`),
    enabled: Boolean(filters.from && filters.to),
    staleTime: 5 * 60_000,
  });

// ─── Download helper + hook (S4-01/02/03) ───────────────────────────────────

export type ReportType = 'conciliacion' | 'volumetria' | 'utilizacion';
export type ReportFormat = 'pdf' | 'xlsx';

export interface DownloadReportParams {
  type: ReportType;
  format: ReportFormat;
  /** Filtros pasados como query string al endpoint binario. */
  filters?: Record<string, string | number | boolean | undefined>;
  /** Override del filename. Default: `<type>-<timestamp>.<format>`. */
  filename?: string;
}

const MIME_BY_FORMAT: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Trigger de descarga binaria (PDF/XLSX). Bypassea el wrapper `api()` (que
 * asume JSON) y usa `fetch` directo al proxy con `responseType` blob.
 *
 * UX:
 *   1. fetch a `/api/proxy/v1/reports/<type>?<qs>&format=<fmt>` con
 *      `Accept: application/pdf|xlsx`.
 *   2. crea Blob → `URL.createObjectURL(blob)` → trigger click `<a>`
 *      con `download="<filename>"`.
 *   3. revoca el objectURL en el siguiente tick (libera memoria sin
 *      cancelar la descarga).
 */
export async function downloadReportBlob({
  type,
  format,
  filters,
  filename,
}: DownloadReportParams): Promise<void> {
  const queryParams = qs({ ...(filters ?? {}), format });
  const url = `/api/proxy/v1/reports/${type}?${queryParams}`;
  const traceId = crypto.randomUUID();
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      accept: MIME_BY_FORMAT[format],
      'x-trace-id': traceId,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`download-failed:${res.status}:${text.slice(0, 256)}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download =
      filename ??
      `${type}-${new Date().toISOString().slice(0, 10)}.${format}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // En Safari el revoke inmediato a veces aborta la descarga; un setTimeout
    // a 0 es el patrón recomendado (queue microtask al final del event loop).
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

/**
 * Hook mutation wrapper de `downloadReportBlob`. Permite que el componente
 * lea `isPending` / `isError` y deshabilite el botón mientras descarga.
 */
export const useDownloadReport = () =>
  useMutation({
    mutationFn: (params: DownloadReportParams) => downloadReportBlob(params),
  });
