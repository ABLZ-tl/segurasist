import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  onRemove?: () => void;
  removable?: boolean;
  removeLabel?: string;
}

export const Tag = React.forwardRef<HTMLSpanElement, TagProps>(
  ({ className, children, onRemove, removable, removeLabel = 'Quitar', ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg',
        className,
      )}
      {...props}
    >
      {children}
      {removable && (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="ml-1 rounded p-0.5 hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      )}
    </span>
  ),
);
Tag.displayName = 'Tag';
