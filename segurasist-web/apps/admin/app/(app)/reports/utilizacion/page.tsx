'use client';

/**
 * S4-03 — Página Utilización por cobertura.
 *
 * Filtros: rango de fechas (BE requerido) + paquete (UI; el filtro real lo
 * aplica el frontend a las rows devueltas del BE — el endpoint actual no
 * soporta filtro server-side por packageId, ver feed S2-iter1).
 */

import * as React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@segurasist/ui';
import { ReportDownloadButtons, UtilizacionChart, ReportFilters, defaultReportFilters, isFilterValid, type ReportFiltersValue } from '../../../../components/reports';

export default function UtilizacionPage(): React.JSX.Element {
  const [filters, setFilters] = React.useState<ReportFiltersValue>(() => defaultReportFilters());
  const valid = isFilterValid(filters);

  return (
    <div className="space-y-6">
      <Section
        title="Utilización por cobertura"
        description="Top consumidores y monto/eventos por cobertura."
      />

      <ReportFilters value={filters} onChange={setFilters} showEntity={false} />

      {valid ? (
        <UtilizacionChart from={filters.from} to={filters.to} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Descargar utilización</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportDownloadButtons
            type="utilizacion"
            filters={{ from: filters.from, to: filters.to }}
            filenameBase={`utilizacion-${filters.from}_a_${filters.to}`}
            disabled={!valid}
          />
        </CardContent>
      </Card>
    </div>
  );
}
