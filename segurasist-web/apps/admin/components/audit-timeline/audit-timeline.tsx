'use client';

/**
 * S4-09 — Timeline de auditoría con scroll infinito + filtros + export.
 *
 * Estructura:
 *   - Header (export button + dropdown filtro).
 *   - Lista vertical `<ol role="feed">` con dots + connecting line, items
 *     en orden cronológico DESC (más reciente arriba).
 *   - Skeleton mientras la primera página carga.
 *   - Empty state cuando `pages[0].items.length === 0`.
 *   - Botón "Cargar más" + IntersectionObserver al sentinel para auto-fetch
 *     al hacer scroll (ambos coexisten: keyboard users tienen el botón).
 *
 * A11y:
 *   - `role="feed"` + `aria-busy={isFetching}` para anunciar el estado.
 *   - Cada item es `role="article"` (en `audit-timeline-item.tsx`).
 *   - Live region `aria-live="polite"` para anunciar nuevos items cargados.
 */
import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  EmptyState,
  Button,
  AlertBanner,
} from '@segurasist/ui';
import {
  useAuditTimeline,
  type AuditTimelineAction,
} from '@segurasist/api-client/hooks/audit-timeline';
import { AuditTimelineItem } from './audit-timeline-item';
import { AuditTimelineExportButton } from './audit-timeline-export-button';

interface Props {
  insuredId: string;
  /** Permite ocultar export en contextos donde se renderiza embebido (p.ej. tab compacto). */
  hideExport?: boolean;
}

const ACTION_FILTERS: { value: AuditTimelineAction | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas las acciones' },
  { value: 'create', label: 'Creaciones' },
  { value: 'update', label: 'Ediciones' },
  { value: 'delete', label: 'Eliminaciones' },
  { value: 'read_viewed', label: 'Vistas 360' },
  { value: 'export_downloaded', label: 'Exports' },
  { value: 'login', label: 'Logins' },
  { value: 'reissue', label: 'Reemisiones' },
];

export function AuditTimeline({ insuredId, hideExport = false }: Props): React.ReactElement {
  const [actionFilter, setActionFilter] = React.useState<AuditTimelineAction | 'all'>('all');
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useAuditTimeline(insuredId, {
    actionFilter: actionFilter === 'all' ? undefined : actionFilter,
  });

  // IntersectionObserver: cuando el sentinel entra en viewport, fetchNextPage.
  React.useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            fetchNextPage();
            break;
          }
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="audit-timeline-skeleton">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <AlertBanner tone="danger" title="No pudimos cargar el timeline.">
        {error instanceof Error ? error.message : 'Error desconocido.'}
      </AlertBanner>
    );
  }

  const allItems = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4" data-testid="audit-timeline-root">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Select
          value={actionFilter}
          onValueChange={(v) => setActionFilter(v as AuditTimelineAction | 'all')}
        >
          <SelectTrigger
            className="w-full sm:w-64"
            aria-label="Filtrar timeline por acción"
            data-testid="audit-timeline-filter"
          >
            <SelectValue placeholder="Filtrar por acción" />
          </SelectTrigger>
          <SelectContent>
            {ACTION_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!hideExport && <AuditTimelineExportButton insuredId={insuredId} />}
      </div>

      {allItems.length === 0 ? (
        <EmptyState
          title="Sin actividad registrada."
          description="Aún no hay eventos de auditoría para este asegurado."
        />
      ) : (
        <>
          <ol
            role="feed"
            aria-busy={isFetching}
            aria-label="Timeline de auditoría"
            data-testid="audit-timeline-list"
            className="relative"
          >
            {allItems.map((entry) => (
              <AuditTimelineItem key={entry.id} entry={entry} />
            ))}
          </ol>
          <div
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
            data-testid="audit-timeline-live"
          >
            {isFetchingNextPage ? 'Cargando más eventos.' : ''}
          </div>
          {hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                data-testid="audit-timeline-load-more"
              >
                {isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
              </Button>
            </div>
          )}
          {/* Sentinel para IntersectionObserver auto-fetch. */}
          <div ref={sentinelRef} aria-hidden data-testid="audit-timeline-sentinel" />
        </>
      )}
    </div>
  );
}
