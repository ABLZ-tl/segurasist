'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@segurasist/ui';
import { Sparkline } from './charts';

interface Kpi {
  label: string;
  value: string;
  trend: number;
  series: number[];
}

const KPIS: Kpi[] = [
  {
    label: 'Asegurados activos',
    value: '12,480',
    trend: 4.2,
    series: [60, 62, 65, 64, 70, 73, 78, 82, 84, 88, 92, 96],
  },
  {
    label: 'Certificados (30d)',
    value: '1,920',
    trend: -1.8,
    series: [80, 82, 78, 76, 74, 70, 72, 68, 66, 64, 62, 60],
  },
  {
    label: 'Siniestros (30d)',
    value: '312',
    trend: 0.6,
    series: [40, 42, 41, 43, 44, 45, 44, 46, 47, 47, 48, 49],
  },
  {
    label: 'Cobertura consumida',
    value: '48%',
    trend: 2.1,
    series: [38, 40, 41, 42, 43, 44, 45, 45, 46, 47, 47, 48],
  },
];

export function KpiGrid(): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {KPIS.map((kpi, i) => (
        <motion.div
          key={kpi.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
        >
          <KpiCard kpi={kpi} />
        </motion.div>
      ))}
    </div>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }): JSX.Element {
  const tone = kpi.trend > 0 ? 'success' : kpi.trend < 0 ? 'danger' : 'muted';
  const TrendIcon = kpi.trend > 0 ? ArrowUpRight : kpi.trend < 0 ? ArrowDownRight : Minus;
  return (
    <div className="group rounded-lg border border-border bg-bg p-4 transition-colors duration-fast lg:p-5 lg:hover:border-border-strong">
      <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{kpi.label}</p>
      <div className="mt-2 flex items-end justify-between gap-2 lg:mt-3 lg:gap-3">
        <p className="text-xl font-semibold tabular-nums tracking-tightest text-fg lg:text-[28px]">{kpi.value}</p>
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
        <Sparkline data={kpi.series} tone={tone === 'muted' ? 'muted' : tone} />
      </div>
    </div>
  );
}
