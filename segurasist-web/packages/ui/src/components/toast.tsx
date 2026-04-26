'use client';

import { Toaster as SonnerToaster, toast } from 'sonner';

/**
 * Wraps Sonner with SegurAsist defaults: top-right, rich colors, accessible
 * announcement (aria-live="polite" by default; pass `important: true` for
 * critical errors to switch to assertive).
 */
export function Toaster() {
  return (
    <SonnerToaster
      richColors
      closeButton
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-bg group-[.toaster]:text-fg group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-fg-muted',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-fg',
          cancelButton: 'group-[.toast]:bg-surface group-[.toast]:text-fg',
        },
      }}
    />
  );
}

export { toast };
