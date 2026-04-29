'use client';

/**
 * <Switch> — Radix Switch wrapper with tenant-aware accent.
 *
 * DS-1 Sprint 5 iter 2. Replaces ad-hoc CSS toggles (e.g. S5-3 KB enable
 * toggle). The active track uses `--tenant-accent` so it picks up the
 * tenant's runtime brand color from `applyBrandableTheme` (see
 * `theme/brandable-tokens.ts`). Inactive track falls back to `--border`.
 *
 * Accessibility:
 *   - Forwards every Radix prop, including `aria-label`, `aria-labelledby`,
 *     `disabled`, controlled `checked` / `onCheckedChange`, etc.
 *   - 44×24 hit target on the wrapper (Radix Root) — meets WCAG 2.5.5
 *     (target size minimum 24×24, recommended 44×44 for primary actions
 *     when paired with a label).
 *   - `data-state` is set by Radix; we hook it via Tailwind variants.
 *   - Focus ring uses the global `--ring` token so it stays visible on
 *     custom tenant backgrounds.
 *
 * Theming policy (NF-DS1-3): we set `--tenant-accent` via inline CSS var,
 * NOT a literal hex, so callers do not bypass the tenant whitelist.
 */

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../lib/cn';

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
      'disabled:cursor-not-allowed disabled:opacity-50',
      // Inactive: subtle border-token track. Active: tenant accent.
      'data-[state=unchecked]:bg-[hsl(var(--border-strong))]',
      'data-[state=checked]:bg-[var(--tenant-accent)]',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block h-5 w-5 rounded-full bg-bg shadow-md ring-0 transition-transform',
        'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

export { Switch };
