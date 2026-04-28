'use client';

/**
 * S4-03 — `<BarChart />` reusable.
 *
 * Wrapper minimalista sobre `recharts`:
 *  - tokens de theme SegurAsist (mismos que `<LineChart />`).
 *  - permite layout vertical (default) u horizontal (`layout="horizontal"`).
 *    El layout horizontal es preferido para Top-N por categoría: las labels
 *    largas (nombres de coberturas) caben legibles en el eje Y.
 *  - tooltip custom consistente con el del Dashboard (S2-05).
 *
 * Diseño: el componente NO decide el alto (lo controla el contenedor padre
 * con `className`/`style`).
 */
import * as React from 'react';
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { cn } from '../../lib/cn';

const AXIS_COLOR = 'hsl(var(--fg-subtle))';
const AXIS_LINE_COLOR = 'hsl(var(--border-strong))';
const TICK_STYLE = {
  fill: AXIS_COLOR,
  fontSize: 11,
  fontFamily: 'var(--font-sans)',
} as const;

const DEFAULT_PALETTE = [
  'hsl(var(--accent))',
  'hsl(var(--fg-muted))',
  'hsl(var(--success))',
  'hsl(var(--danger))',
];

export interface BarChartSeries {
  dataKey: string;
  label?: string;
  color?: string;
}

export interface BarChartProps<T> {
  data: readonly T[];
  /** Atajo para una sola serie. */
  dataKey?: string;
  series?: readonly BarChartSeries[];
  /** Key del campo categoría (default `'name'`). */
  categoryKey?: string;
  /** 'vertical' = barras verticales, 'horizontal' = barras horizontales (Top-N). */
  layout?: 'vertical' | 'horizontal';
  className?: string;
  ariaLabel?: string;
  valueFormatter?: (value: number) => string;
}

function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
}: TooltipProps<number, string> & { valueFormatter?: (v: number) => string }): React.JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-bg-overlay px-3 py-2 text-[13px] shadow-md">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
        {String(label)}
      </p>
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 capitalize text-fg-muted">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: typeof p.color === 'string' ? p.color : 'hsl(var(--accent))' }}
              />
              {p.name ?? String(p.dataKey)}
            </span>
            <span className="font-mono text-fg tabular-nums">
              {valueFormatter && typeof p.value === 'number' ? valueFormatter(p.value) : String(p.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarChart<T>({
  data,
  dataKey,
  series,
  categoryKey = 'name',
  layout = 'vertical',
  className,
  ariaLabel = 'Gráfico de barras',
  valueFormatter,
}: BarChartProps<T>): React.JSX.Element {
  const resolvedSeries: readonly BarChartSeries[] = React.useMemo(() => {
    if (series && series.length > 0) return series;
    if (dataKey) return [{ dataKey, label: dataKey }];
    return [];
  }, [series, dataKey]);

  // Recharts terminology nuance: `layout="vertical"` en recharts significa
  // barras horizontales (categoría en eje Y). Mapeamos nuestro contrato (más
  // intuitivo para usuarios: 'horizontal' = barras horizontales) al recharts.
  const rechartsLayout: 'vertical' | 'horizontal' = layout === 'horizontal' ? 'vertical' : 'horizontal';
  const isHorizontal = layout === 'horizontal';

  return (
    <div
      className={cn('h-64 w-full', className)}
      role="img"
      aria-label={ariaLabel}
      data-testid="bar-chart"
    >
      <ResponsiveContainer>
        <RBarChart
          data={data as Array<Record<string, unknown>>}
          layout={rechartsLayout}
          margin={{ top: 8, right: 16, left: isHorizontal ? 16 : -16, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="2 4" vertical={isHorizontal} horizontal={!isHorizontal} stroke="hsl(var(--border))" />
          {isHorizontal ? (
            <>
              <XAxis
                type="number"
                stroke={AXIS_LINE_COLOR}
                tickLine={false}
                axisLine={false}
                tick={TICK_STYLE}
                tickFormatter={(v) => (typeof v === 'number' ? v.toLocaleString('es-MX') : String(v))}
              />
              <YAxis
                type="category"
                dataKey={categoryKey}
                stroke={AXIS_LINE_COLOR}
                tickLine={false}
                tick={TICK_STYLE}
                width={140}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey={categoryKey}
                stroke={AXIS_LINE_COLOR}
                tickLine={false}
                tick={TICK_STYLE}
                interval={0}
              />
              <YAxis
                stroke={AXIS_LINE_COLOR}
                tickLine={false}
                axisLine={false}
                tick={TICK_STYLE}
                width={36}
                tickFormatter={(v) => (typeof v === 'number' ? v.toLocaleString('es-MX') : String(v))}
              />
            </>
          )}
          <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} cursor={{ fill: 'hsl(var(--bg-elevated))' }} />
          {resolvedSeries.map((s, i) => (
            <Bar
              key={s.dataKey}
              dataKey={s.dataKey}
              name={s.label ?? s.dataKey}
              fill={s.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]}
              radius={isHorizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
              maxBarSize={isHorizontal ? 18 : 28}
              isAnimationActive={false}
            />
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}
