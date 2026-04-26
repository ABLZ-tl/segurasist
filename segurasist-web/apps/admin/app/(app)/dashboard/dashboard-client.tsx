'use client';

/**
 * S2-05 — Dashboard client.
 *
 * Reemplaza el mock data del Día 3 con `useDashboard()` (TanStack Query).
 * Estados:
 *  - loading  → Skeleton primitives en cada bloque (KPIs + charts + tablas).
 *  - error    → AlertBanner con detail del traceId si está disponible.
 *  - empty    → cuando todos los KPIs están en 0 (tenant nuevo): copy
 *               "Aún no hay datos. Sube tu primer lote en /batches."
 *  - ok       → render real, polling a 60s.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { AlertBanner, EmptyState, Skeleton, cn } from '@segurasist/ui';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { useDashboard, type DashboardKpi } from '../../../lib/hooks/use-dashboard';
import { Sparkline } from './charts';

interface KpiUiSpec {
  label: string;
  key: keyof import('../../../lib/hooks/use-dashboard').DashboardKpis;
  format?: (v: number) => string;
}

const KPI_SPECS: KpiUiSpec[] = [
  { label: 'Asegurados activos', key: 'activeInsureds', format: (v) => v.toLocaleString('es-MX') },
  { label: 'Certificados (30d)', key: 'certificates30d', format: (v) => v.toLocaleString('es-MX') },
  { label: 'Siniestros (30d)', key: 'claims30d', format: (v) => v.toLocaleString('es-MX') },
  {
    label: 'Cobertura consumida',
    key: 'coverageConsumedPct',
    format: (v) => `${v}%`,
  },
];

const AXIS_COLOR = 'hsl(var(--fg-subtle))';
const AXIS_LINE_COLOR = 'hsl(var(--border-strong))';
const tickStyle = {
  fill: AXIS_COLOR,
  fontSize: 11,
  fontFamily: 'var(--font-sans)',
} as const;

export function DashboardClient(): JSX.Element {
  const { data, isLoading, isError, error } = useDashboard();

  if (isLoading) return <DashboardSkeleton />;

  if (isError) {
    return (
      <AlertBanner tone="danger" title="No pudimos cargar el resumen">
        {(error as Error)?.message ?? 'Intenta nuevamente en unos segundos.'}
      </AlertBanner>
    );
  }

  if (!data) return <DashboardSkeleton />;

  const allZero = Object.values(data.kpis).every((k) => k.value === 0);
  if (allZero && data.recentBatches.length === 0) {
    return (
      <EmptyState
        title="Aún no hay datos"
        description="Sube tu primer lote en /batches para empezar a ver indicadores."
      />
    );
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-testid="kpi-grid">
        {KPI_SPECS.map((spec, i) => (
          <motion.div
            key={spec.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
          >
            <KpiCard
              label={spec.label}
              kpi={data.kpis[spec.key]}
              format={spec.format ?? ((v) => String(v))}
              series={data.volumetry.map((w) => w.altas + w.certs)}
            />
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ChartCard title="Altas y bajas" description="Últimas 12 semanas">
          <VolumetryLineChart data={data.volumetry} />
        </ChartCard>
        <ChartCard title="Certificados emitidos" description="Por semana — últimas 12 semanas">
          <VolumetryBarChart data={data.volumetry} />
        </ChartCard>
      </div>

      <RecentTables
        batches={data.recentBatches}
        certificates={data.recentCertificates}
      />
    </div>
  );
}

function KpiCard({
  label,
  kpi,
  format,
  series,
}: {
  label: string;
  kpi: DashboardKpi;
  format: (v: number) => string;
  series: number[];
}): JSX.Element {
  const tone = kpi.trend > 0 ? 'success' : kpi.trend < 0 ? 'danger' : 'muted';
  const TrendIcon = kpi.trend > 0 ? ArrowUpRight : kpi.trend < 0 ? ArrowDownRight : Minus;
  return (
    <div className="group rounded-lg border border-border bg-bg p-4 transition-colors duration-fast lg:p-5 lg:hover:border-border-strong">
      <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2 lg:mt-3 lg:gap-3">
        <p className="text-xl font-semibold tabular-nums tracking-tightest text-fg lg:text-[28px]">
          {format(kpi.value)}
        </p>
        <div
          className={cn(
            'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
            tone === 'success' && 'bg-success/10 text-success',
            tone === 'danger' && 'bg-danger/10 text-danger',
            tone === 'muted' && 'bg-bg-elevated text-fg-muted',
          )}
        >
          <TrendIcon className="h-3 w-3" />
          <span className="tabular-nums">
            {kpi.trend > 0 ? '+' : ''}
            {kpi.trend}%
          </span>
        </div>
      </div>
      <div className="mt-2 h-8 lg:mt-3 lg:h-12">
        <Sparkline data={series.length > 0 ? series : [0, 0]} tone={tone === 'muted' ? 'muted' : tone} />
      </div>
    </div>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-bg">
      <header className="flex items-baseline justify-between border-b border-border px-4 py-3 sm:px-5">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold tracking-tighter text-fg lg:text-lg">{title}</h2>
          <p className="text-[12px] text-fg-subtle">{description}</p>
        </div>
      </header>
      <div className="px-2 py-3 sm:px-5 sm:py-4">{children}</div>
    </section>
  );
}

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-bg-overlay px-3 py-2 text-[13px] shadow-md">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{label}</p>
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 capitalize text-fg-muted">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: typeof p.color === 'string' ? p.color : 'hsl(var(--accent))' }}
              />
              {String(p.dataKey)}
            </span>
            <span className="font-mono text-fg tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VolumetryLineChart({
  data,
}: {
  data: import('../../../lib/hooks/use-dashboard').DashboardVolumetryWeek[];
}): JSX.Element {
  return (
    <div className="h-56 w-full" role="img" aria-label="Gráfico de altas y bajas (12 semanas)">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="week" stroke={AXIS_LINE_COLOR} tickLine={false} tick={tickStyle} />
          <YAxis stroke={AXIS_LINE_COLOR} tickLine={false} axisLine={false} tick={tickStyle} width={32} />
          <Tooltip content={<ChartTooltip />} />
          <Line type="monotone" dataKey="altas" stroke="hsl(var(--accent))" strokeWidth={1.6} dot={false} />
          <Line
            type="monotone"
            dataKey="bajas"
            stroke="hsl(var(--fg-muted))"
            strokeWidth={1.4}
            strokeDasharray="3 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function VolumetryBarChart({
  data,
}: {
  data: import('../../../lib/hooks/use-dashboard').DashboardVolumetryWeek[];
}): JSX.Element {
  return (
    <div className="h-56 w-full" role="img" aria-label="Certificados emitidos por semana">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="week" stroke={AXIS_LINE_COLOR} tickLine={false} tick={tickStyle} />
          <YAxis stroke={AXIS_LINE_COLOR} tickLine={false} axisLine={false} tick={tickStyle} width={32} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="certs" fill="hsl(var(--accent))" radius={[3, 3, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RecentTables({
  batches,
  certificates,
}: {
  batches: import('../../../lib/hooks/use-dashboard').DashboardRecentBatch[];
  certificates: import('../../../lib/hooks/use-dashboard').DashboardRecentCertificate[];
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <section className="overflow-hidden rounded-lg border border-border bg-bg">
        <header className="flex items-baseline justify-between border-b border-border px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold tracking-tighter text-fg lg:text-lg">Lotes recientes</h2>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-[13px]">
            <thead className="bg-bg-elevated text-fg-subtle">
              <tr>
                <th className="px-5 py-2 text-[11px] font-medium uppercase tracking-wider">Archivo</th>
                <th className="px-5 py-2 text-right text-[11px] font-medium uppercase tracking-wider">Filas</th>
                <th className="px-5 py-2 text-[11px] font-medium uppercase tracking-wider">Estado</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-fg-muted">
                    Aún no hay lotes
                  </td>
                </tr>
              ) : (
                batches.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-5 py-3 font-mono text-[12.5px] text-fg">{row.fileName}</td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-fg-muted">
                      {row.rowsTotal.toLocaleString('es-MX')}
                    </td>
                    <td className="px-5 py-3 text-fg-muted">{row.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-bg">
        <header className="flex items-baseline justify-between border-b border-border px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold tracking-tighter text-fg lg:text-lg">
            Últimos certificados
          </h2>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-[13px]">
            <thead className="bg-bg-elevated text-fg-subtle">
              <tr>
                <th className="px-5 py-2 text-[11px] font-medium uppercase tracking-wider">Asegurado</th>
                <th className="px-5 py-2 text-[11px] font-medium uppercase tracking-wider">Paquete</th>
                <th className="px-5 py-2 text-right text-[11px] font-medium uppercase tracking-wider">Emitido</th>
              </tr>
            </thead>
            <tbody>
              {certificates.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-fg-muted">
                    Aún no hay certificados
                  </td>
                </tr>
              ) : (
                certificates.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-5 py-3 text-fg">{row.insuredFullName}</td>
                    <td className="px-5 py-3 text-fg-muted">{row.packageName}</td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-fg-muted">
                      {new Date(row.issuedAt).toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DashboardSkeleton(): JSX.Element {
  return (
    <div className="space-y-6 lg:space-y-8" data-testid="dashboard-skeleton">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}
