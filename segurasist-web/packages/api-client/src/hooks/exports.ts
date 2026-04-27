/**
 * S3-09 — Hooks para el flujo de exportación XLSX/PDF.
 *
 *  - `useRequestExport()` mutation → POST /v1/insureds/export.
 *  - `useExportStatus(exportId, opts)` query con polling cada 2s hasta
 *    status='ready' o 'failed'.
 *
 * El backend devuelve un `downloadUrl` presigned 24h cuando ready. El
 * componente `ExportButton` abre la URL en una nueva pestaña sin pasar
 * por el proxy interno (es S3 directo) — ese es el motivo de los 24h:
 * el browser puede tardar en descargar.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface ExportFilters {
  q?: string;
  packageId?: string;
  status?: 'active' | 'suspended' | 'cancelled' | 'expired';
  validFromGte?: string;
  validFromLte?: string;
  validToGte?: string;
  validToLte?: string;
  bouncedOnly?: boolean;
}

export interface ExportRequestBody {
  format: 'xlsx' | 'pdf';
  filters: ExportFilters;
}

export interface ExportRequestResponse {
  exportId: string;
  status: 'pending';
}

export interface ExportStatusResponse {
  exportId: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  format: 'xlsx' | 'pdf';
  rowCount: number | null;
  downloadUrl?: string;
  expiresAt?: string;
  hash?: string;
  error?: string;
  requestedAt: string;
  completedAt?: string;
}

export const exportsKeys = {
  all: ['exports'] as const,
  status: (id: string) => ['exports', 'status', id] as const,
};

export const useRequestExport = () =>
  useMutation({
    mutationFn: (body: ExportRequestBody) =>
      api<ExportRequestResponse>('/v1/insureds/export', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });

/**
 * Polling cada 2s del status. Cuando alcanza 'ready' o 'failed', el
 * `refetchInterval` se vuelve `false` para detener el polling
 * (TanStack Query se desuscribe del intervalo).
 */
export const useExportStatus = (exportId: string | null) =>
  useQuery({
    queryKey: exportsKeys.status(exportId ?? '__none__'),
    queryFn: () => api<ExportStatusResponse>(`/v1/exports/${exportId}`),
    enabled: !!exportId,
    refetchInterval: (query) => {
      const data = query.state.data as ExportStatusResponse | undefined;
      if (!data) return 2000;
      if (data.status === 'ready' || data.status === 'failed') return false;
      return 2000;
    },
    staleTime: 0,
  });
