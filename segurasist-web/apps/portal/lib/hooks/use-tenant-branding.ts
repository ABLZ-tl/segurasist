'use client';

import { useContext } from 'react';
import {
  TenantBrandingContext,
  TenantBrandingActionsContext,
  type TenantBranding,
  type TenantBrandingActions,
} from '../../components/tenant/tenant-context';

/**
 * Hook tipado para consumir branding del tenant activo. Devuelve `TenantBranding`
 * con valores default seguros incluso fuera del Provider — el portal nunca
 * crashea por ausencia de contexto, solo registra warning en dev.
 *
 * Uso:
 *   const { displayName, primaryHex, logoUrl, isLoading } = useTenantBranding();
 *
 * NO selecciona slices (useSyncExternalStore) — la branding cambia raramente
 * (5 min stale time) y un re-render del consumer es barato comparado con el
 * boilerplate de selectors.
 */
export function useTenantBranding(): TenantBranding {
  const ctx = useContext(TenantBrandingContext);
  if (process.env.NODE_ENV !== 'production' && ctx == null) {
    // No debería pasar — el context tiene default seguro. Si pasara,
    // dejamos rastro para debugging en vez de crash.
    // eslint-disable-next-line no-console
    console.warn('[useTenantBranding] context returned null — provider missing');
  }
  return ctx;
}

/**
 * Hook tipado para invocar las acciones imperativas del Provider (CC-08).
 *
 *   const { resetBranding } = useTenantBrandingActions();
 *   await fetch('/api/auth/portal-logout', { ... });
 *   resetBranding();        // ← antes del redirect: evita FOUC en /login
 *   router.replace('/login');
 *
 * Devuelve no-op cuando el consumer está fuera del Provider (ej. página
 * pública), así no es necesario un null-check defensivo en cada call site.
 */
export function useTenantBrandingActions(): TenantBrandingActions {
  return useContext(TenantBrandingActionsContext);
}
