/**
 * S2-05 — Dashboard response DTOs.
 *
 * El FE consume `GET /v1/reports/dashboard`. La shape es estable:
 * agregaremos fields nuevos en versiones futuras pero NO renombramos ni
 * eliminamos. Cuando OpenAPI esté wired, este archivo es el source of
 * truth para la generación de tipos.
 */

export interface DashboardKpi {
  value: number;
  trend: number;
}

export interface DashboardKpis {
  activeInsureds: DashboardKpi;
  certificates30d: DashboardKpi;
  claims30d: DashboardKpi;
  coverageConsumedPct: DashboardKpi;
}

export interface VolumetryWeek {
  week: string;
  altas: number;
  bajas: number;
  certs: number;
}

export interface RecentBatch {
  id: string;
  fileName: string;
  rowsTotal: number;
  status: string;
  createdAt: string;
}

export interface RecentCertificate {
  id: string;
  insuredFullName: string;
  packageName: string;
  issuedAt: string;
}

export interface DashboardResponse {
  kpis: DashboardKpis;
  volumetry: VolumetryWeek[];
  recentBatches: RecentBatch[];
  recentCertificates: RecentCertificate[];
  generatedAt: string;
}
