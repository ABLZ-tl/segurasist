import * as React from 'react';
import { cn } from '../lib/cn';

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  active?: boolean;
}

export const Pill = React.forwardRef<HTMLSpanElement, PillProps>(
  ({ className, active, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium',
        active
          ? 'border-primary bg-primary text-primary-fg'
          : 'border-border bg-bg text-fg-muted hover:bg-surface',
        className,
      )}
      {...props}
    />
  ),
);
Pill.displayName = 'Pill';
