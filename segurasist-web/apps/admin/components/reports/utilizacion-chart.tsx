'use client';

/**
 * S4-03 — `<UtilizacionChart />`.
 *
 * Bar chart Top-N por cobertura ordenado por `usageAmount` descending.
 * Layout horizontal: nombres de coberturas suelen ser largos.
 *
 * El componente acepta `from`/`to` y `topN` controlados externamente. La
 * página padre maneja los filtros (paquete, rango).
 *
 * Estados: loading / error / empty / ok.
 */

import * as React from 'react';
import {
  AlertBanner,
  BarChart,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@segurasist/ui';
import { useUtilizacion } from '@segurasist/api-client/hooks/reports';

export interface UtilizacionChartProps {
  /** ISO date `YYYY-MM-DD`. */
  from: string;
  /** ISO date `YYYY-MM-DD`. */
  to: string;
  /** tenantId override (solo platformAdmin). */
  tenantId?: string;
}

const TOP_N_OPTIONS = [5, 10, 20] as const;

const NUMBER = new Intl.NumberFormat('es-MX');

export function UtilizacionChart({ from, to, tenantId }: UtilizacionChartProps): React.JSX.Element {
  const [topN, setTopN] = React.useState<number>(10);
  const filters = React.useMemo(
    () => ({ from, to, topN, ...(tenantId ? { tenantId } : {}) }),
    [from, to, topN, tenantId],
  );
  const { data, isLoading, isError, error } = useUtilizacion(filters);

  const chartData = React.useMemo(() => {
    if (!data) return [];
    // BE ya devuelve ordenado y limitado por topN. Mapeamos a categoría/valor.
    return data.rows.map((r) => ({
      name: r.coverageName,
      packageName: r.packageName,
      usageAmount: r.usageAmount,
      usageCount: r.usageCount,
    }));
  }, [data]);

  return (
    <Card data-testid="utilizacion-chart">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Utilización por cobertura</CardTitle>
            <CardDescription>Top {topN} con mayor consumo (suma de monto por evento).</CardDescription>
          </div>
          <Select value={String(topN)} onValueChange={(v) => setTopN(Number(v))}>
            <SelectTrigger className="w-32" aria-label="Cambiar Top N">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOP_N_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Top {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-72 w-full rounded-md" data-testid="utilizacion-skeleton" />
        ) : isError ? (
          <AlertBanner tone="danger" title="No pudimos cargar la utilización">
            {(error as Error)?.message ?? 'Intenta nuevamente en unos segundos.'}
          </AlertBanner>
        ) : chartData.length === 0 ? (
          <EmptyState
            title="Sin datos"
            description="No hay coberturas con consumo registrado en el rango seleccionado."
          />
        ) : (
          <BarChart
            data={chartData}
            categoryKey="name"
            series={[
              { dataKey: 'usageAmount', label: 'Monto', color: 'hsl(var(--accent))' },
            ]}
            layout="horizontal"
            ariaLabel={`Utilización por cobertura, top ${topN}`}
            valueFormatter={(v) => NUMBER.format(v)}
            className="h-[28rem]"
          />
        )}
      </CardContent>
    </Card>
  );
}
