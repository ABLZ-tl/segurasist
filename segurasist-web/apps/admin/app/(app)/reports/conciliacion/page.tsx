'use client';

/**
 * S4-01 — Reporte de Conciliación mensual.
 *
 * Página admin con:
 *  - `<ReportFilters />` (date range)
 *  - grid de stats con totales del período (BE devuelve agregado, no rows)
 *  - `<ReportDownloadButtons />` (PDF + XLSX)
 *
 * Layout `(app)` ya autentica. RBAC reforzado por backend en cada endpoint.
 *
 * Shape consumida del BE (S1, fixed iter1):
 *   { from, to, tenantId, activosInicio, activosCierre, altas, bajas,
 *     certificadosEmitidos, claimsCount, claimsAmountEstimated,
 *     claimsAmountApproved, coverageUsageCount, coverageUsageAmount,
 *     generatedAt }
 */

import * as React from 'react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Section,
  Skeleton,
  Stat,
} from '@segurasist/ui';
import { useConciliacionReport } from '@segurasist/api-client/hooks/reports';
import {
  ReportFilters,
  ReportDownloadButtons,
  defaultReportFilters,
  isFilterValid,
  type ReportFiltersValue,
} from '../../../../components/reports';

const CURRENCY = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const NUMBER = new Intl.NumberFormat('es-MX');

export default function ConciliacionPage(): React.JSX.Element {
  const [filters, setFilters] = React.useState<ReportFiltersValue>(() => defaultReportFilters());
  const valid = isFilterValid(filters);

  const { data, isLoading, isError, error } = useConciliacionReport(
    valid ? filters : { from: '', to: '' },
  );

  const downloadFilters = React.useMemo<Record<string, string | undefined>>(() => {
    const p: Record<string, string | undefined> = { from: filters.from, to: filters.to };
    if (filters.entityId) p.tenantId = filters.entityId;
    return p;
  }, [filters]);

  return (
    <div className="space-y-6">
      <Section
        title="Conciliación mensual"
        description="Reporte ejecutivo con totales de altas, bajas, certificados y siniestros del período."
      />

      <ReportFilters value={filters} onChange={setFilters} />

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <CardTitle>Descargar reporte</CardTitle>
            {data && (
              <Badge variant="secondary">
                Generado: {new Date(data.generatedAt).toLocaleString('es-MX')}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ReportDownloadButtons
            type="conciliacion"
            filters={downloadFilters}
            filenameBase={`conciliacion-${filters.from}_a_${filters.to}`}
            disabled={!valid}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vista previa</CardTitle>
        </CardHeader>
        <CardContent>
          {!valid ? (
            <EmptyState
              title="Selecciona un rango"
              description="Define las fechas Desde y Hasta para previsualizar el reporte."
            />
          ) : isLoading ? (
            <div
              className="grid grid-cols-2 gap-3 lg:grid-cols-4"
              data-testid="conciliacion-skeleton"
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-md" />
              ))}
            </div>
          ) : isError ? (
            <p
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"
              role="alert"
            >
              No pudimos cargar la vista previa. {(error as Error)?.message ?? ''}
            </p>
          ) : !data ? (
            <EmptyState title="Sin datos" description="No hay actividad en el rango seleccionado." />
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Activos inicio" value={NUMBER.format(data.activosInicio)} />
              <Stat label="Activos cierre" value={NUMBER.format(data.activosCierre)} />
              <Stat label="Altas" value={NUMBER.format(data.altas)} />
              <Stat label="Bajas" value={NUMBER.format(data.bajas)} />
              <Stat
                label="Certificados emitidos"
                value={NUMBER.format(data.certificadosEmitidos)}
              />
              <Stat label="Siniestros (count)" value={NUMBER.format(data.claimsCount)} />
              <Stat
                label="Monto estimado"
                value={CURRENCY.format(data.claimsAmountEstimated)}
              />
              <Stat
                label="Monto aprobado"
                value={CURRENCY.format(data.claimsAmountApproved)}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
