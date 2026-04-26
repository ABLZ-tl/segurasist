import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-bg transition-colors duration-fast ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg active:bg-accent-hover lg:hover:bg-accent-hover',
        secondary: 'border border-border bg-bg-elevated text-fg active:border-border-strong lg:hover:border-border-strong',
        ghost: 'text-fg active:bg-bg-elevated lg:hover:bg-bg-elevated',
        destructive: 'bg-danger text-accent-fg active:bg-danger/90 lg:hover:bg-danger/90',
        outline: 'border border-border bg-transparent text-fg active:bg-bg-elevated lg:hover:border-border-strong lg:hover:bg-bg-elevated',
        link: 'text-accent underline-offset-4 lg:hover:underline',
      },
      size: {
        sm: 'min-h-[44px] px-3 text-xs lg:h-9 lg:min-h-0',
        md: 'h-11 min-h-[44px] px-4 py-2', // 44px tap target for portal
        lg: 'h-12 min-h-[48px] px-6 text-base',
        icon: 'h-11 min-h-[44px] w-11 min-w-[44px]',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  loadingText?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, loadingText, children, disabled, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            <span>{loadingText ?? children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
