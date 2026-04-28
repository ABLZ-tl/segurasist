'use client';

/**
 * S4-01 — Filtros para Reportes (date range + entityId opcional).
 *
 * Decisiones UX:
 *  - Dos `<DatePicker />` independientes (desde / hasta) — patrón consistente
 *    con `<ExportButton />` (S3-09) y más simple a11y que un range picker
 *    en un mismo popover.
 *  - Default: últimos 30 días (siguiendo MVP_05: dashboard volumetría 90d,
 *    conciliación mensual default).
 *  - Validación: `from <= to`. Si se viola, mostramos un texto inline; el
 *    componente padre puede leer `isValid` para deshabilitar el botón
 *    "Aplicar"/"Descargar".
 *
 * El componente es controlado: el padre maneja el estado y pasa
 * `onChange(filters)`.
 */

import * as React from 'react';
import { DatePicker, Input, Section } from '@segurasist/ui';

export interface ReportFiltersValue {
  from: string; // ISO YYYY-MM-DD
  to: string; // ISO YYYY-MM-DD
  entityId?: string;
}

export interface ReportFiltersProps {
  value: ReportFiltersValue;
  onChange: (next: ReportFiltersValue) => void;
  /** Mostrar input para filtrar por entidad emisora (default true). */
  showEntity?: boolean;
}

export function isFilterValid(v: ReportFiltersValue): boolean {
  if (!v.from || !v.to) return false;
  return v.from <= v.to;
}

function toISO(d: Date | undefined): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

function fromISO(iso: string): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Default: últimos 30 días (incluyendo hoy). */
export function defaultReportFilters(now: Date = new Date()): ReportFiltersValue {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: toISO(from), to: toISO(to) };
}

export function ReportFilters({
  value,
  onChange,
  showEntity = true,
}: ReportFiltersProps): React.JSX.Element {
  const valid = isFilterValid(value);
  return (
    <Section
      title="Filtros"
      description="Selecciona el rango de fechas y, opcionalmente, la entidad emisora."
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-fg-muted" id="report-from-label">
            Desde
          </span>
          <DatePicker
            value={fromISO(value.from)}
            onChange={(d) => onChange({ ...value, from: toISO(d) })}
            ariaLabel="Fecha desde"
            placeholder="Fecha desde"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-fg-muted" id="report-to-label">
            Hasta
          </span>
          <DatePicker
            value={fromISO(value.to)}
            onChange={(d) => onChange({ ...value, to: toISO(d) })}
            ariaLabel="Fecha hasta"
            placeholder="Fecha hasta"
          />
        </div>
        {showEntity && (
          <div className="flex flex-col gap-1 sm:min-w-[14rem]">
            <label htmlFor="report-entity" className="text-[12px] font-medium text-fg-muted">
              Entidad (opcional)
            </label>
            <Input
              id="report-entity"
              placeholder="ID de entidad"
              value={value.entityId ?? ''}
              onChange={(e) => onChange({ ...value, entityId: e.target.value || undefined })}
            />
          </div>
        )}
      </div>
      {!valid && (value.from || value.to) ? (
        <p className="text-[12px] text-danger" role="alert" data-testid="report-filters-error">
          La fecha &ldquo;Desde&rdquo; debe ser anterior o igual a &ldquo;Hasta&rdquo;.
        </p>
      ) : null}
    </Section>
  );
}
