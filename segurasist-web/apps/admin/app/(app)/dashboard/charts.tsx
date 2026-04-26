'use client';

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

const TREND_DATA = Array.from({ length: 12 }, (_, i) => ({
  week: `S${i + 1}`,
  altas: 80 + Math.round(Math.sin(i / 2) * 30 + ((i * 13) % 21)),
  bajas: 20 + Math.round(Math.cos(i / 2) * 10 + ((i * 7) % 15)),
}));

const CERTS_DATA = Array.from({ length: 14 }, (_, i) => ({
  day: `D${i + 1}`,
  certs: 60 + ((i * 17) % 41),
}));

const AXIS_COLOR = 'hsl(var(--fg-subtle))';
const AXIS_LINE_COLOR = 'hsl(var(--border-strong))';

const tickStyle = {
  fill: AXIS_COLOR,
  fontSize: 11,
  fontFamily: 'var(--font-sans)',
} as const;

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

export function TrendChart(): JSX.Element {
  return (
    <div className="h-56 w-full" role="img" aria-label="Gráfico de altas y bajas en 90 días">
      <ResponsiveContainer>
        <LineChart data={TREND_DATA} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="week"
            stroke={AXIS_LINE_COLOR}
            tickLine={false}
            axisLine={{ stroke: AXIS_LINE_COLOR }}
            tick={tickStyle}
          />
          <YAxis
            stroke={AXIS_LINE_COLOR}
            tickLine={false}
            axisLine={false}
            tick={tickStyle}
            width={32}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'hsl(var(--border-strong))', strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey="altas"
            stroke="hsl(var(--accent))"
            strokeWidth={1.6}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: 'hsl(var(--accent))' }}
          />
          <Line
            type="monotone"
            dataKey="bajas"
            stroke="hsl(var(--fg-muted))"
            strokeWidth={1.4}
            strokeDasharray="3 3"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: 'hsl(var(--fg-muted))' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CertsByDayChart(): JSX.Element {
  return (
    <div className="h-56 w-full" role="img" aria-label="Certificados emitidos por día (14 días)">
      <ResponsiveContainer>
        <BarChart data={CERTS_DATA} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="day"
            stroke={AXIS_LINE_COLOR}
            tickLine={false}
            axisLine={{ stroke: AXIS_LINE_COLOR }}
            tick={tickStyle}
          />
          <YAxis
            stroke={AXIS_LINE_COLOR}
            tickLine={false}
            axisLine={false}
            tick={tickStyle}
            width={32}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--bg-elevated))' }} />
          <Bar dataKey="certs" fill="hsl(var(--accent))" radius={[3, 3, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface SparklineProps {
  data: number[];
  tone?: 'accent' | 'success' | 'danger' | 'muted';
}

export function Sparkline({ data, tone = 'accent' }: SparklineProps): JSX.Element {
  const stroke =
    tone === 'success'
      ? 'hsl(var(--success))'
      : tone === 'danger'
      ? 'hsl(var(--danger))'
      : tone === 'muted'
      ? 'hsl(var(--fg-muted))'
      : 'hsl(var(--accent))';
  const series = data.map((v, i) => ({ i, v }));
  return (
    <div className="h-full min-h-[32px] w-full">
      <ResponsiveContainer>
        <LineChart data={series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <Line type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.4} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
