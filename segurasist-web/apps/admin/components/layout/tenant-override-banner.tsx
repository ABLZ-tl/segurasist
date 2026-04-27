'use client';

/**
 * S3-08 — Banner amber persistente top cuando el switcher está activo.
 *
 * Visible si y solo si `useTenantOverride.overrideTenantId !== null`. Color
 * amber para reforzar awareness (security req #5: el operador NO debe olvidar
 * que está operando como otro tenant).
 *
 * Acciones:
 *  - Botón "Volver a mi tenant" → clearOverride + invalidateQueries.
 */

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTenantOverride } from '../../lib/hooks/use-tenant-override';

export function TenantOverrideBanner(): JSX.Element | null {
  const { overrideTenantId, overrideTenantName, clearOverride } = useTenantOverride();
  const qc = useQueryClient();

  const onClear = React.useCallback(() => {
    clearOverride();
    void qc.invalidateQueries();
  }, [clearOverride, qc]);

  if (!overrideTenantId) return null;

  const label = overrideTenantName ?? overrideTenantId;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-14 z-20 flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-[13px] text-amber-900 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100"
    >
      <span>
        <span aria-hidden className="mr-2">
          &#x1F504;
        </span>
        Operando como tenant: <strong>{label}</strong> (admin_segurasist)
      </span>
      <button
        type="button"
        onClick={onClear}
        className="rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-[12px] font-medium text-amber-900 transition-colors hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-600 dark:bg-amber-800/50 dark:text-amber-50 dark:hover:bg-amber-700/60"
      >
        Volver a mi tenant
      </button>
    </div>
  );
}
