import * as React from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const alertVariants = cva('flex w-full items-start gap-3 rounded-md border p-4 text-sm', {
  variants: {
    tone: {
      info: 'border-accent/30 bg-accent/5 text-fg',
      success: 'border-success/30 bg-success/5 text-fg',
      warning: 'border-warning/30 bg-warning/5 text-fg',
      danger: 'border-danger/30 bg-danger/5 text-fg',
    },
  },
  defaultVariants: { tone: 'info' },
});

const iconByTone = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
} as const;

export interface AlertBannerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string;
}

export function AlertBanner({ className, tone, title, children, ...props }: AlertBannerProps) {
  const Icon = iconByTone[tone ?? 'info'];
  return (
    <div role="alert" className={cn(alertVariants({ tone }), className)} {...props}>
      <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-fg-muted">{children}</div>}
      </div>
    </div>
  );
}
