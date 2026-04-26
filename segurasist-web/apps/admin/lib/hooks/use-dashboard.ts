/**
 * S2-05 — Local hook re-export. La lógica vive en `@segurasist/api-client`
 * para que el portal y otros consumidores puedan importarla. El admin app
 * re-exporta acá por convención del story (`apps/admin/lib/hooks/...`) y
 * para permitir overrides locales (e.g. mock en tests).
 */

export {
  useDashboard,
  dashboardKeys,
  type DashboardData,
  type DashboardKpi,
  type DashboardKpis,
  type DashboardVolumetryWeek,
  type DashboardRecentBatch,
  type DashboardRecentCertificate,
} from '@segurasist/api-client/hooks/dashboard';
