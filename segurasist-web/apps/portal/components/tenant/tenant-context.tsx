'use client';

import * as React from 'react';

/**
 * Tenant branding shape — espejo del contrato `GET /v1/tenants/me/branding`
 * que MT-1 publica en Sprint 5 iter 1.
 *
 * Forma confirmada en `docs/sprint5/DISPATCH_PLAN.md` §"Contratos a publicar":
 *   { tenantId, displayName, tagline, logoUrl, primaryHex, accentHex,
 *     bgImageUrl, lastUpdatedAt }
 *
 * Se enriquece con flags `isLoading`/`isError` para que los consumidores
 * (header, footer, sidebar) puedan renderizar fallbacks sin un suspense
 * boundary explícito por componente.
 */
export interface TenantBranding {
  tenantId: string | null;
  displayName: string;
  tagline: string | null;
  logoUrl: string | null;
  primaryHex: string;
  accentHex: string;
  bgImageUrl: string | null;
  lastUpdatedAt: string | null;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Defaults seguros: el portal jamás debe quedar en blanco si la branding
 * API falla. Mantenemos los hex de SegurAsist (verde + violeta) y el nombre
 * institucional. Cualquier consumer que use estos valores obtiene una UI
 * legible y consistente.
 */
export const DEFAULT_TENANT_BRANDING: TenantBranding = {
  tenantId: null,
  displayName: 'SegurAsist',
  tagline: null,
  logoUrl: null,
  primaryHex: '#16a34a',
  accentHex: '#7c3aed',
  bgImageUrl: null,
  lastUpdatedAt: null,
  isLoading: true,
  isError: false,
};

/**
 * React Context con default seguro para que `useTenantBranding()` nunca
 * lance fuera de un Provider — devuelve el shape default y el hook
 * marca el bug en consola (no crash).
 */
export const TenantBrandingContext = React.createContext<TenantBranding>(
  DEFAULT_TENANT_BRANDING,
);

TenantBrandingContext.displayName = 'TenantBrandingContext';

/**
 * Acciones imperativas sobre el branding (CC-08, Sprint 5 iter 2).
 *
 * Vive en un context separado (NO mezclado con el shape de datos) para que
 * los consumidores que solo necesitan disparar `resetBranding()` no
 * re-renderen cuando cambian los datos del branding (header/sidebar) — y al
 * revés.
 *
 * Default: `resetBranding` es no-op cuando no hay Provider, así que un
 * llamado fuera del shell no rompe (solo no-op).
 */
export interface TenantBrandingActions {
  /**
   * Restaura los CSS vars y limpia el cache react-query del branding.
   * Pensado para invocarse desde el handler de logout antes del redirect:
   * evita FOUC con colores/logo del tenant previo en pantalla de /login.
   */
  resetBranding: () => void;
}

export const TenantBrandingActionsContext =
  React.createContext<TenantBrandingActions>({
    resetBranding: () => {
      /* no-op fuera del Provider */
    },
  });

TenantBrandingActionsContext.displayName = 'TenantBrandingActionsContext';
