'use client';

/**
 * S4-02 — `<VolumetriaChart />`.
 *
 * Line chart 90 días: altas / bajas / certificados emitidos.
 * Usa `<LineChart />` del `@segurasist/ui` y `useVolumetria()` de api-client.
 *
 * Estados:
 *  - loading → Skeleton placeholder
 *  - error   → AlertBanner inline
 *  - empty   → EmptyState ("Sin datos en el rango seleccionado")
 *  - ok      → render del chart
 */

import * as React from 'react';
import {
  AlertBanner,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  LineChart,
  Skeleton,
} from '@segurasist/ui';
import { useVolumetria } from '@segurasist/api-client/hooks/reports';

const SERIES = [
  { dataKey: 'altas', label: 'Altas', color: 'hsl(var(--accent))' },
  { dataKey: 'bajas', label: 'Bajas', color: 'hsl(var(--fg-muted))', dashed: true },
  { dataKey: 'certificados', label: 'Certificados', color: 'hsl(var(--success))' },
  { dataKey: 'claims', label: 'Siniestros', color: 'hsl(var(--danger))' },
] as const;

function formatXTick(v: unknown): string {
  if (typeof v !== 'string') return String(v ?? '');
  // ISO YYYY-MM-DD → "12 abr"
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

export interface VolumetriaChartProps {
  /** Días hacia atrás (default 90). */
  days?: number;
}

export function VolumetriaChart({ days = 90 }: VolumetriaChartProps): React.JSX.Element {
  const { data, isLoading, isError, error } = useVolumetria(days);

  return (
    <Card data-testid="volumetria-chart">
      <CardHeader>
        <CardTitle>Volumetría — últimos {days} días</CardTitle>
        <CardDescription>
          Altas, bajas y certificados emitidos por día.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-64 w-full rounded-md" data-testid="volumetria-skeleton" />
        ) : isError ? (
          <AlertBanner tone="danger" title="No pudimos cargar la volumetría">
            {(error as Error)?.message ?? 'Intenta nuevamente en unos segundos.'}
          </AlertBanner>
        ) : !data || data.points.length === 0 ? (
          <EmptyState
            title="Sin datos"
            description="Aún no hay actividad registrada en el rango seleccionado."
          />
        ) : (
          <LineChart
            data={data.points}
            xKey="date"
            series={SERIES}
            ariaLabel={`Tendencia de altas, bajas y certificados, últimos ${days} días`}
            xTickFormatter={formatXTick}
            valueFormatter={(v) => v.toLocaleString('es-MX')}
          />
        )}
      </CardContent>
    </Card>
  );
}
