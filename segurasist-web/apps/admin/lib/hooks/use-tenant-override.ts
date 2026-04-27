/**
 * S3-08 — Tenant override store (Zustand).
 *
 * Solo usado por `admin_segurasist`. Persistencia: in-memory (NO localStorage,
 * NO sessionStorage) — el switcher se resetea a "default" al refresh, lo que
 * reduce el risk de que el operador olvide que está impersonando a otro tenant
 * (security req #6 de S3-08).
 *
 * Estado:
 *  - `overrideTenantId`: UUID del tenant impersonado, o `null` si está
 *    operando como su propio tenant (path bypass del superadmin).
 *  - `overrideTenantName`: nombre para mostrar en el banner. Se setea en el
 *    mismo `setOverride(...)` para evitar un round-trip extra al backend
 *    (el dropdown ya tiene la lista cargada).
 *
 * El store NO conoce nada del backend ni del fetch wrapper — el wrapper lee
 * `useTenantOverride.getState()` en cada request (ver `packages/api-client/
 * src/client.ts`). Pattern: store-as-source-of-truth, single direction.
 */
import { create } from 'zustand';

export interface TenantOverrideState {
  overrideTenantId: string | null;
  overrideTenantName: string | null;
  setOverride: (tenantId: string, tenantName: string) => void;
  clearOverride: () => void;
}

export const useTenantOverride = create<TenantOverrideState>((set) => ({
  overrideTenantId: null,
  overrideTenantName: null,
  setOverride: (tenantId, tenantName) =>
    set({ overrideTenantId: tenantId, overrideTenantName: tenantName }),
  clearOverride: () => set({ overrideTenantId: null, overrideTenantName: null }),
}));
