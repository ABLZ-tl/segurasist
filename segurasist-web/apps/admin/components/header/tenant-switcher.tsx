'use client';

/**
 * S3-08 — Tenant switcher real (reemplaza el mock inline en el layout).
 *
 * Visibilidad:
 *  - Solo `admin_segurasist` ve el dropdown completo. Para los demás roles
 *    se renderiza una versión read-only (`TenantSwitcherDisabledForRole`)
 *    con el nombre del tenant del JWT.
 *
 * Comportamiento:
 *  - Carga `/v1/tenants/active` con TanStack Query (staleTime 5 min). El
 *    backend (RBAC) ya rechaza el endpoint si el rol no es admin_segurasist
 *    — defensa en profundidad: el frontend tampoco lo invoca.
 *  - Default option: "Mi tenant (sin override)" → clearOverride.
 *  - Al seleccionar un tenant distinto:
 *      1. setOverride en el store Zustand.
 *      2. queryClient.invalidateQueries() para refetchear TODO con el
 *         nuevo header.
 *      3. (El banner amber se renderiza por el componente padre cuando
 *         el store reporta override activo.)
 */

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@segurasist/api-client';
import { useTenantOverride } from '../../lib/hooks/use-tenant-override';
import type { Role } from '../../lib/rbac';

export interface ActiveTenant {
  id: string;
  name: string;
  slug: string;
}

const NO_OVERRIDE_VALUE = '__none__';

export const tenantSwitcherKeys = {
  active: ['tenants', 'active'] as const,
};

interface TenantSwitcherProps {
  role: Role | null;
  /** Nombre/slug del tenant del JWT del usuario (mostrado en el read-only). */
  ownTenantLabel?: string;
}

/**
 * Read-only para todos los roles distintos de admin_segurasist.
 * Renderiza un texto plano con el tenant del usuario; sin interacción.
 */
export function TenantSwitcherDisabledForRole({ ownTenantLabel }: { ownTenantLabel?: string }): JSX.Element {
  return (
    <div className="hidden w-48 lg:block">
      <div
        aria-label="Tenant actual"
        className="flex h-8 items-center rounded-md border border-border bg-bg-elevated px-3 text-[13px] text-fg-muted"
      >
        {ownTenantLabel ?? 'Mi tenant'}
      </div>
    </div>
  );
}

export function TenantSwitcher({ role, ownTenantLabel }: TenantSwitcherProps): JSX.Element | null {
  const isSuper = role === 'admin_segurasist';
  const { overrideTenantId, setOverride, clearOverride } = useTenantOverride();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: tenantSwitcherKeys.active,
    queryFn: () => api<ActiveTenant[]>('/v1/tenants/active'),
    staleTime: 5 * 60_000,
    enabled: isSuper,
  });

  const onChange = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      if (value === NO_OVERRIDE_VALUE) {
        clearOverride();
      } else {
        const t = (query.data ?? []).find((x) => x.id === value);
        // Si por alguna race el tenant no está en la lista, NO seteamos.
        // (Defensa: nunca enviamos un override inválido al backend.)
        if (t) setOverride(t.id, t.name);
      }
      // Re-fetchear TODO: las queries activas usan el nuevo header en sus
      // próximas requests. invalidateQueries dispara refetches en background.
      void qc.invalidateQueries();
    },
    [qc, query.data, setOverride, clearOverride],
  );

  if (!isSuper) {
    return <TenantSwitcherDisabledForRole ownTenantLabel={ownTenantLabel} />;
  }

  const value = overrideTenantId ?? NO_OVERRIDE_VALUE;
  const tenants = query.data ?? [];

  return (
    <div className="hidden w-56 lg:block">
      <label className="sr-only" htmlFor="tenant-switcher">
        Cambiar tenant
      </label>
      <select
        id="tenant-switcher"
        aria-label="Cambiar tenant"
        value={value}
        onChange={onChange}
        disabled={query.isLoading}
        className="h-8 w-full rounded-md border border-border bg-bg-elevated px-2 text-[13px] text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value={NO_OVERRIDE_VALUE}>Mi tenant (sin override)</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
