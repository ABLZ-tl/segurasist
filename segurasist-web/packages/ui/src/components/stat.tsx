import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '../lib/cn';
import { Card, CardContent } from './card';

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  /** Optional trend in percentage points (positive = up). */
  trend?: number;
  trendLabel?: string;
  loading?: boolean;
}

export function Stat({ label, value, trend, trendLabel, loading, className, ...props }: StatProps) {
  const TrendIcon = trend === undefined ? Minus : trend > 0 ? ArrowUpRight : trend < 0 ? ArrowDownRight : Minus;
  const trendTone = trend === undefined ? 'text-fg-muted' : trend > 0 ? 'text-success' : trend < 0 ? 'text-danger' : 'text-fg-muted';
  return (
    <Card className={cn('w-full', className)} {...props}>
      <CardContent className="flex flex-col gap-2 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</p>
        {loading ? (
          <div className="h-8 w-24 animate-pulse rounded bg-surface" aria-hidden />
        ) : (
          <p className="text-3xl font-semibold tabular-nums text-fg">{value}</p>
        )}
        {trend !== undefined && (
          <div className={cn('flex items-center gap-1 text-xs font-medium', trendTone)}>
            <TrendIcon aria-hidden className="h-3.5 w-3.5" />
            <span>
              {trend > 0 ? '+' : ''}
              {trend}% {trendLabel ?? 'vs periodo anterior'}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
