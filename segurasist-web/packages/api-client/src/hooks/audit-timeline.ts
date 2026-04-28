/**
 * S4-09 — Hooks para el timeline de auditoría de la vista 360.
 *
 *  - `useAuditTimeline(insuredId, opts)` — `useInfiniteQuery` con keyset
 *    cursor. `getNextPageParam` extrae `nextCursor` del último page.
 *  - `useDownloadAuditCSV(insuredId)` — mutation que pega contra
 *    `/v1/audit/timeline/export?format=csv` vía proxy, recibe el CSV como
 *    blob y dispara la descarga en el navegador.
 *
 * Diseño:
 *   - El backend pagina por keyset `(occurredAt, id)` DESC. El cursor es
 *     opaco (base64url) — aquí lo reenviamos sin inspección.
 *   - El export CSV NO va por `api()` (que asume JSON). Pegamos a
 *     `/api/proxy/v1/audit/timeline/export?...` con `fetch()` directo,
 *     verificamos `res.ok`, leemos `blob()` y disparamos `<a download>`.
 *   - `actionFilter` opcional para el dropdown de filtro en el FE.
 */
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { api } from '../client';
import { qs } from '../qs';

export type AuditTimelineAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'read'
  | 'login'
  | 'logout'
  | 'export'
  | 'reissue'
  | 'otp_requested'
  | 'otp_verified'
  | 'read_viewed'
  | 'read_downloaded'
  | 'export_downloaded';

export interface AuditTimelineItem {
  id: string;
  occurredAt: string;
  action: AuditTimelineAction | string;
  resourceType: string;
  resourceId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  ipMasked: string | null;
  userAgent: string | null;
  payloadDiff: Record<string, unknown> | unknown[] | null;
}

export interface AuditTimelinePage {
  items: AuditTimelineItem[];
  nextCursor: string | null;
}

export interface UseAuditTimelineOptions {
  limit?: number;
  actionFilter?: AuditTimelineAction;
  enabled?: boolean;
}

export const auditTimelineKeys = {
  all: ['audit-timeline'] as const,
  list: (insuredId: string, actionFilter?: string) =>
    ['audit-timeline', 'list', insuredId, actionFilter ?? null] as const,
};

/**
 * Infinite query con keyset cursor. Cada page = `{items, nextCursor}`.
 * `getNextPageParam` devuelve el cursor del último page o `undefined` (stop).
 */
export const useAuditTimeline = (insuredId: string, opts: UseAuditTimelineOptions = {}) =>
  useInfiniteQuery<AuditTimelinePage, Error>({
    queryKey: auditTimelineKeys.list(insuredId, opts.actionFilter),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params: Record<string, string | number | undefined> = {
        insuredId,
        limit: opts.limit ?? 20,
      };
      if (typeof pageParam === 'string' && pageParam.length > 0) {
        params.cursor = pageParam;
      }
      if (opts.actionFilter) {
        params.actionFilter = opts.actionFilter;
      }
      return api<AuditTimelinePage>(`/v1/audit/timeline?${qs(params)}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!insuredId && (opts.enabled ?? true),
    staleTime: 30_000,
  });

/**
 * Descarga el CSV del timeline. Lleva el blob al click handler — el
 * caller tipico:
 *
 *   const { mutateAsync, isPending } = useDownloadAuditCSV(insuredId);
 *   <button onClick={() => mutateAsync()}>Exportar CSV</button>
 */
export const useDownloadAuditCSV = (insuredId: string) =>
  useMutation<void, Error, void>({
    mutationFn: async () => {
      const traceId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const res = await fetch(
        `/api/proxy/v1/audit/timeline/export?insuredId=${encodeURIComponent(insuredId)}&format=csv`,
        {
          method: 'GET',
          headers: { 'x-trace-id': traceId },
        },
      );
      if (!res.ok) {
        throw new Error(`Export CSV falló: HTTP ${res.status}`);
      }
      const blob = await res.blob();
      // Disparar descarga sin abandonar la página. El proxy Next ya seteó
      // `content-disposition: attachment`, pero la API DOM `<a download>` da
      // mejor UX (no opens new tab si el browser ignora el header).
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-timeline-${insuredId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Liberar object URL en el siguiente tick.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  });
