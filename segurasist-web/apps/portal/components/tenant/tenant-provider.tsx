'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast, applyBrandableTheme } from '@segurasist/ui';
import { tenantBrandingKeys } from '@segurasist/api-client/hooks/admin-tenants';
import {
  DEFAULT_TENANT_BRANDING,
  TenantBrandingContext,
  TenantBrandingActionsContext,
  type TenantBranding,
} from './tenant-context';

/**
 * Shape exacto del payload de `GET /v1/tenants/me/branding` (MT-1, Sprint 5).
 * Cualquier drift backend↔frontend lo capturamos en el parser defensivo —
 * jamás propagamos `undefined`/`null` al consumer (siempre defaults).
 */
interface BrandingApiResponse {
  tenantId?: string | null;
  displayName?: string | null;
  tagline?: string | null;
  logoUrl?: string | null;
  primaryHex?: string | null;
  accentHex?: string | null;
  bgImageUrl?: string | null;
  lastUpdatedAt?: string | null;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function safeHex(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback;
  return HEX_RE.test(input) ? input : fallback;
}

function safeStr(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback;
  const t = input.trim();
  return t.length > 0 ? t : fallback;
}

function safeUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const t = input.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    // Solo http(s) — defensa contra `javascript:` que el browser bloquearía
    // pero igual filtramos antes de pasarlo a `<img src>` o CSS var.
    return u.protocol === 'https:' || u.protocol === 'http:' ? t : null;
  } catch {
    return null;
  }
}

/**
 * Convierte `#16a34a` en `22 163 74` para que pueda usarse dentro de
 * `rgb(var(--tenant-primary-rgb) / <alpha>)`. Permite alpha en utilities
 * Tailwind y mantiene el contrato CSS-vars-only (no inline color).
 */
function hexToRgbTriplet(hex: string): string {
  const m = HEX_RE.exec(hex);
  if (!m) return '22 163 74';
  const int = parseInt(hex.slice(1), 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  return `${r} ${g} ${b}`;
}

export interface TenantProviderProps {
  children: React.ReactNode;
  /**
   * Fetcher override para tests — si no se pasa, hace `fetch('/api/proxy/v1/tenants/me/branding')`
   * que viaja por el proxy con cookie httpOnly.
   */
  fetcher?: () => Promise<BrandingApiResponse>;
  /** Initial data para SSR/tests sin red. */
  initialData?: BrandingApiResponse | null;
}

const DEFAULT_FETCHER = async (): Promise<BrandingApiResponse> => {
  const res = await fetch('/api/proxy/v1/tenants/me/branding', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    // Marker para que el provider haga redirect — no `throw new Error('401')`
    // crudo porque react-query lo serializa en `error.message` y queremos
    // distinguir auth-failure de 5xx.
    const err = new Error('UNAUTHORIZED') as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as BrandingApiResponse;
};

/**
 * Aplica la branding al `<html>` mediante `style.setProperty` — esto NO
 * cuenta como "inline style" CSP-restricted (no es un `<style>` ni un
 * `style=""` attribute en HTML), así que evita el `'unsafe-inline'` debate.
 *
 * Setea triple representación:
 *   --tenant-primary-rgb (para `rgb(var(...) / <alpha>)`)
 *   --tenant-primary-hex (para `color: var(--tenant-primary-hex)`)
 *   --tenant-logo-url    (background-image opcional)
 *
 * Idempotente — re-aplicarla con los mismos valores no causa repaint.
 */
function applyBrandingToDom(branding: TenantBranding): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--tenant-primary-hex', branding.primaryHex);
  root.style.setProperty(
    '--tenant-primary-rgb',
    hexToRgbTriplet(branding.primaryHex),
  );
  root.style.setProperty('--tenant-accent-hex', branding.accentHex);
  root.style.setProperty(
    '--tenant-accent-rgb',
    hexToRgbTriplet(branding.accentHex),
  );
  if (branding.bgImageUrl) {
    root.style.setProperty('--tenant-bg-image', `url("${branding.bgImageUrl}")`);
  } else {
    root.style.setProperty('--tenant-bg-image', 'none');
  }
  if (branding.logoUrl) {
    root.style.setProperty('--tenant-logo-url', `url("${branding.logoUrl}")`);
  } else {
    root.style.setProperty('--tenant-logo-url', 'none');
  }
  root.dataset.tenantId = branding.tenantId ?? '';
}

/**
 * Provider del portal asegurado — bootstrap branding con SWR + apply DOM.
 *
 * Orquesta:
 *  1. `useQuery(tenantBrandingKeys.portalSelf)` con stale 5min, gc 10min, retry 1.
 *     La key viaja desde `@segurasist/api-client` para que cualquier mutación
 *     admin (`useUpdateBrandingMutation`) invalide automáticamente el portal.
 *  2. Mientras carga: usa defaults SegurAsist; el shell se renderiza con
 *     `displayName="SegurAsist"` y verde MAC — UX no-blocking.
 *  3. En 401: redirect cliente a /login (cookie expirada). NO hard-redirect
 *     server-side desde aquí; el middleware ya tiene su propio gate y
 *     este path es defensivo (cookie expira mid-session).
 *  4. En 5xx: defaults + toast aviso, NO bloquea la app.
 *  5. En éxito: parsea defensivamente + `applyBrandingToDom`.
 */
export function TenantProvider({
  children,
  fetcher,
  initialData,
}: TenantProviderProps): JSX.Element {
  const router = useRouter();
  const errorToastShown = React.useRef(false);

  const queryClient = useQueryClient();

  const query = useQuery<BrandingApiResponse, Error & { status?: number }>({
    // CC-05: keep this key EXACTLY in sync with `tenantBrandingKeys.portalSelf`
    // exported from `@segurasist/api-client/hooks/admin-tenants` so admin-side
    // mutations (`useUpdateBrandingMutation`) cross-invalidate the portal cache.
    queryKey: tenantBrandingKeys.portalSelf,
    queryFn: fetcher ?? DEFAULT_FETCHER,
    staleTime: 5 * 60_000, // 5 min — cumple §"Tenant context en portal".
    gcTime: 10 * 60_000, // ex-cacheTime
    retry: (failureCount, err): boolean => {
      // 401 NUNCA reintenta — disparamos redirect.
      if ((err as { status?: number })?.status === 401) return false;
      return failureCount < 1;
    },
    initialData: initialData ?? undefined,
    refetchOnWindowFocus: false,
  });

  // 401 → redirect /login. Hacemos navegación cliente para preservar el
  // toast/UX que el middleware mostrará en próxima requeest.
  React.useEffect(() => {
    if (query.isError && (query.error as { status?: number })?.status === 401) {
      router.replace('/login' as never);
    }
  }, [query.isError, query.error, router]);

  // 5xx (cualquier error que NO sea 401) → toast UNA vez por sesión de provider.
  React.useEffect(() => {
    if (
      query.isError &&
      (query.error as { status?: number })?.status !== 401 &&
      !errorToastShown.current
    ) {
      errorToastShown.current = true;
      try {
        toast.message?.(
          'Algunas personalizaciones no están disponibles. Mostrando estilo predeterminado.',
        );
      } catch {
        /* toast no disponible en jsdom — no bloquea */
      }
    }
  }, [query.isError, query.error]);

  // Combinar payload + defaults → branding final.
  const branding = React.useMemo<TenantBranding>(() => {
    const data = query.data;
    if (!data) {
      return {
        ...DEFAULT_TENANT_BRANDING,
        isLoading: query.isLoading,
        isError: query.isError,
      };
    }
    return {
      tenantId: typeof data.tenantId === 'string' ? data.tenantId : null,
      displayName: safeStr(data.displayName, DEFAULT_TENANT_BRANDING.displayName),
      tagline: typeof data.tagline === 'string' && data.tagline.trim() ? data.tagline.trim() : null,
      logoUrl: safeUrl(data.logoUrl),
      primaryHex: safeHex(data.primaryHex, DEFAULT_TENANT_BRANDING.primaryHex),
      accentHex: safeHex(data.accentHex, DEFAULT_TENANT_BRANDING.accentHex),
      bgImageUrl: safeUrl(data.bgImageUrl),
      lastUpdatedAt:
        typeof data.lastUpdatedAt === 'string' ? data.lastUpdatedAt : null,
      isLoading: false,
      isError: false,
    };
  }, [query.data, query.isLoading, query.isError]);

  // Aplicar al DOM en cada cambio de branding válido.
  React.useEffect(() => {
    if (branding.isLoading) return;
    applyBrandingToDom(branding);
  }, [branding]);

  /**
   * CC-08: setter expuesto para handlers de logout / tenant-switch. Restaura
   *  - CSS vars con `applyBrandableTheme(DEFAULT_BRANDING)` (DS-1) +
   *    nuestras vars compuestas via `applyBrandingToDom(DEFAULT_TENANT_BRANDING)`,
   *  - limpia `dataset.tenantId`,
   *  - cancela cualquier fetch en vuelo y quita el cache react-query
   *    (`tenantBrandingKeys.portalSelf`) para que el próximo login dispare
   *    un fetch fresco — y para que el observer activo no dispare un refetch
   *    inmediato que re-aplicaría el branding del tenant anterior antes del
   *    redirect.
   *
   * Estable entre renders (deps fijas) — seguro consumirlo desde un effect.
   */
  const resetBranding = React.useCallback((): void => {
    // 1. Cancelar fetch en vuelo: previene race donde un PUT acaba de
    //    invalidar la cache y la respuesta llega después del logout.
    void queryClient.cancelQueries({ queryKey: tenantBrandingKeys.portalSelf });
    // 2. Aplicar defaults seguros vía DS-1 helper (cubre `--tenant-primary` etc.).
    applyBrandableTheme({
      primaryHex: DEFAULT_TENANT_BRANDING.primaryHex,
      accentHex: DEFAULT_TENANT_BRANDING.accentHex,
      bgImageUrl: null,
    });
    // 3. Y nuestras vars portal-internas (-hex/-rgb/--tenant-logo-url/-bg-image).
    applyBrandingToDom({
      ...DEFAULT_TENANT_BRANDING,
      isLoading: false,
      isError: false,
    });
    if (typeof document !== 'undefined' && document.documentElement) {
      delete document.documentElement.dataset.tenantId;
    }
    // 4. Quitar el cache para que el próximo mount no herede el branding
    //    del tenant anterior. `removeQueries` también desuscribe los
    //    observers activos del data anterior.
    queryClient.removeQueries({ queryKey: tenantBrandingKeys.portalSelf });
  }, [queryClient]);

  // Memoizamos las acciones para no invalidar consumidores en cada render.
  const actions = React.useMemo(
    () => ({ resetBranding }),
    [resetBranding],
  );

  return (
    <TenantBrandingContext.Provider value={branding}>
      <TenantBrandingActionsContext.Provider value={actions}>
        {children}
      </TenantBrandingActionsContext.Provider>
    </TenantBrandingContext.Provider>
  );
}


// Export interno solo para tests — permite probar la conversión hex→rgb
// sin re-implementar la lógica.
export const __test = { hexToRgbTriplet, safeHex, safeUrl };
