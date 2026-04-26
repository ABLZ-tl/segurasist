/**
 * S2-05 — Dashboard hook.
 *
 * Pega `GET /v1/reports/dashboard`. El backend devuelve KPIs + volumetry +
 * recents. Cache server-side de 60s; client-side `staleTime` de 60s y
 * `refetchInterval` igual para auto-refresh sin sobrecarga.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

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

export interface DashboardVolumetryWeek {
  week: string;
  altas: number;
  bajas: number;
  certs: number;
}

export interface DashboardRecentBatch {
  id: string;
  fileName: string;
  rowsTotal: number;
  status: string;
  createdAt: string;
}

export interface DashboardRecentCertificate {
  id: string;
  insuredFullName: string;
  packageName: string;
  issuedAt: string;
}

export interface DashboardData {
  kpis: DashboardKpis;
  volumetry: DashboardVolumetryWeek[];
  recentBatches: DashboardRecentBatch[];
  recentCertificates: DashboardRecentCertificate[];
  generatedAt: string;
}

export const dashboardKeys = {
  all: ['reports', 'dashboard'] as const,
};

export const useDashboard = () =>
  useQuery({
    queryKey: dashboardKeys.all,
    queryFn: () => api<DashboardData>('/v1/reports/dashboard'),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
