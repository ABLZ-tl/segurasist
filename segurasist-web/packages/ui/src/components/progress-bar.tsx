'use client';

import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '../lib/cn';

export interface ProgressBarProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  value: number;
  max?: number;
  label?: string;
  /** Override colour by semantic level */
  tone?: 'success' | 'warning' | 'danger' | 'accent';
}

export const ProgressBar = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressBarProps
>(({ className, value, max = 100, label, tone = 'accent', ...props }, ref) => {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const fill =
    tone === 'success'
      ? 'bg-success'
      : tone === 'warning'
        ? 'bg-warning'
        : tone === 'danger'
          ? 'bg-danger'
          : 'bg-accent';
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={pct}
      aria-label={label}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-surface', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full transition-all', fill)}
        style={{ width: `${pct}%` }}
      />
    </ProgressPrimitive.Root>
  );
});
ProgressBar.displayName = 'ProgressBar';
