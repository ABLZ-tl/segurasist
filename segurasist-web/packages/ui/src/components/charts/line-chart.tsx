'use client';

/**
 * S4-02 — `<LineChart />` reusable.
 *
 * Wrapper minimalista sobre `recharts` con:
 *  - tokens de theme SegurAsist (`--fg-subtle`, `--border`, `--accent`).
 *  - tooltip custom consistente con el del Dashboard (S2-05).
 *  - acepta múltiples series: si pasás `series` se renderizan todas con los
 *    colores del array; si solo pasás `dataKey` se renderiza una serie con
 *    `--accent`.
 *
 * Diseño: el componente NO decide el alto (lo controla el contenedor padre
 * con `className`/`style`) para permitir cards responsivas.
 */
import * as React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart as RLineChart,
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

export interface LineChartSeries {
  /** Key del campo del datum a graficar. */
  dataKey: string;
  /** Label human-readable (default: `dataKey`). */
  label?: string;
  /** Color override (CSS color). Si se omite, se rota el palette default. */
  color?: string;
  /** Si true → línea punteada (típico para "comparación" o "esperado"). */
  dashed?: boolean;
}

export interface LineChartProps<T> {
  data: readonly T[];
  /** Atajo para una sola serie. Si se pasa `series` también, gana `series`. */
  dataKey?: string;
  /** Múltiples series; si se omite, se construye desde `dataKey`. */
  series?: readonly LineChartSeries[];
  /** Key del campo X (default: `'date'`). */
  xKey?: string;
  /** Alto en `class` Tailwind (default `h-64`). */
  className?: string;
  /** A11y label para `role="img"` (default genérico). */
  ariaLabel?: string;
  /** Formatter del eje X (e.g. fecha → "Abr 12"). */
  xTickFormatter?: (value: unknown) => string;
  /** Formatter de los valores en tooltip. */
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

export function LineChart<T>({
  data,
  dataKey,
  series,
  xKey = 'date',
  className,
  ariaLabel = 'Gráfico de líneas',
  xTickFormatter,
  valueFormatter,
}: LineChartProps<T>): React.JSX.Element {
  const resolvedSeries: readonly LineChartSeries[] = React.useMemo(() => {
    if (series && series.length > 0) return series;
    if (dataKey) return [{ dataKey, label: dataKey }];
    return [];
  }, [series, dataKey]);

  return (
    <div
      className={cn('h-64 w-full', className)}
      role="img"
      aria-label={ariaLabel}
      data-testid="line-chart"
    >
      <ResponsiveContainer>
        <RLineChart data={data as Array<Record<string, unknown>>} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey={xKey}
            stroke={AXIS_LINE_COLOR}
            tickLine={false}
            tick={TICK_STYLE}
            tickFormatter={xTickFormatter}
            minTickGap={24}
          />
          <YAxis
            stroke={AXIS_LINE_COLOR}
            tickLine={false}
            axisLine={false}
            tick={TICK_STYLE}
            width={36}
            tickFormatter={(v) => (typeof v === 'number' ? v.toLocaleString('es-MX') : String(v))}
          />
          <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} />
          {resolvedSeries.map((s, i) => (
            <Line
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              name={s.label ?? s.dataKey}
              stroke={s.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]}
              strokeWidth={1.6}
              strokeDasharray={s.dashed ? '3 3' : undefined}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
}
