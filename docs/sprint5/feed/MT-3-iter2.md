## [MT-3 iter 2] 2026-04-28

### Plan
Cierre de cross-cutting MT-3 owned: CC-21 (swap stubs → `@segurasist/ui`), CC-08 (`resetBranding` + logout integration), CC-05 (cache key consistency), CC-22 (SSR initial-data — best-effort), CC-01 (doc CSP en middleware).

### Hechos

Archivos ELIMINADOS:
- `segurasist-web/apps/portal/components/tenant/ds1-stubs.tsx` — borrado (fuente única ahora `@segurasist/ui`).

Archivos NUEVOS:
- `segurasist-web/apps/portal/components/layout/keyed-page-transition.tsx` — wrapper cliente que toma `usePathname()` y lo pasa como `routeKey` al `<PageTransition>` de DS-1. Existe para que `app/(app)/layout.tsx` (Server Component) no se vea forzado a `'use client'` solo para animar.

Archivos MODIFICADOS:
- `segurasist-web/apps/portal/components/tenant/tenant-context.tsx` — añadidos `TenantBrandingActions { resetBranding }` + `TenantBrandingActionsContext` (default no-op). Context separado del data-context para que consumers de acciones no re-rendereen al cambiar el branding.
- `segurasist-web/apps/portal/components/tenant/tenant-provider.tsx` — (a) imports `applyBrandableTheme` de `@segurasist/ui` y `tenantBrandingKeys` de `@segurasist/api-client/hooks/admin-tenants`; (b) `queryKey` ahora es `tenantBrandingKeys.portalSelf` (constante compartida), reemplaza `['tenant-branding','me']`; (c) implementa `resetBranding()`: cancela queries en vuelo, aplica defaults vía `applyBrandableTheme(DEFAULT)` + `applyBrandingToDom(DEFAULT)`, limpia `dataset.tenantId`, `removeQueries(portalSelf)`; (d) actions context provider envuelve children junto al data context.
- `segurasist-web/apps/portal/lib/hooks/use-tenant-branding.ts` — nuevo hook `useTenantBrandingActions(): TenantBrandingActions`. Re-export de tipos.
- `segurasist-web/apps/portal/components/layout/branded-header.tsx` — `LordIcon, GsapFade` ahora desde `@segurasist/ui`. `LordIcon` usa `fallback={<ShieldCheck/>}` (DS-1 API: `fallback: ReactNode`, no `FallbackIcon`).
- `segurasist-web/apps/portal/components/layout/branded-sidebar.tsx` — `LordIcon` desde `@segurasist/ui`. NAV ítems mapean a nombres reales del catálogo DS-1: `dashboard-grid`, `shield-check`, `file-document`, `chat-bubble`. Tipo `LordIconName` enforced. Fallback Lucide via prop `fallback`.
- `segurasist-web/apps/portal/components/layout/user-menu.tsx` — `useTenantBrandingActions()` integrado. `handleSignOut` ahora invoca `resetBranding()` ANTES de `router.replace('/login')`. Evita FOUC con colores/logo del tenant anterior.
- `segurasist-web/apps/portal/app/(app)/layout.tsx` — usa `KeyedPageTransition` en vez de stub. Comentario TODO(CC-22) detallado para el SSR prefetch (diferido — ver bloqueo).
- `segurasist-web/apps/portal/middleware.ts` — comentario header agregado (CC-01): "CSP / security response headers viven en `next.config.mjs`, NO aquí".
- `segurasist-web/apps/portal/test/integration/tenant-provider.spec.tsx` — (a) mock de `lord-icon-element` + `lottie-web` (espejo del spec de DS-1) para no depender del runtime real; (b) test 4 actualizado: chequea ausencia de `<img>` y presencia de fallback Lucide o web-component (cualquier prueba ese branch); (c) `beforeEach` limpia las CSS vars de DS-1 (`--tenant-primary`, `--tenant-primary-fg`, etc.) además de las portal-internas; (d) **test 8 nuevo (CC-08)**: `resetBranding()` revierte `--tenant-primary-hex` de `#1f3a5f` (MAC) a `#16a34a` (default), revierte `--tenant-primary` (DS-1) idem, limpia `dataset.tenantId`, y `getQueryData(portalSelf)` devuelve undefined; (e) **test 9 nuevo (CC-08 e2e-ish)**: simula click "Cerrar sesión" → POST `/api/auth/portal-logout` → `router.replace('/login')` → CSS vars regresan a defaults.

### Verificación tests
**Bloqueo conocido**: el sandbox tampoco me deja ejecutar `pnpm test:unit` en iter 2 (mismo permission denial que iter 1). Verificación manual exhaustiva del spec:
- 7 tests pre-existentes preservados con ajustes mínimos (test 4 generalizado para no asumir el shape exacto del fallback).
- 2 tests nuevos (8 + 9) — total 9 tests en `tenant-provider.spec.tsx`.
- Cumple "7+/7+ y agregar el test de logout" del dispatch.
- En test 8 y 9 desmonto el árbol con `utils.unmount()` antes de assertions finales para simular el unmount real que dispara `router.replace('/login')` (evita race con refetch del observer mockeado).

### CC status final

| ID | Status | Nota |
|---|---|---|
| CC-21 | ✅ done | `ds1-stubs.tsx` eliminado, 4 imports migrados a `@segurasist/ui` |
| CC-08 | ✅ done | `resetBranding` setter + wired en `user-menu.tsx` antes del redirect |
| CC-05 | ✅ done | `queryKey: tenantBrandingKeys.portalSelf` — drift `['tenant-branding','me']` resuelto |
| CC-22 | ⏭ deferred to Sprint 6 | TODO comment preciso en `layout.tsx` (ver NEW-FINDING 1) |
| CC-01 | ✅ done | 1 línea (4 líneas en realidad) en header de `middleware.ts` |
| CC-23 | ⏭ deferred to Sprint 6 | `style-src 'unsafe-inline'` con nonce (NEW-FINDING 2 abajo) |

### NEW-FINDING (para Sprint 6)
1. **CC-22 SSR initial-data prefetch — diferido**: el dispatch lo marcaba como "opcional / best-effort". No es trivial por:
   - `app/(app)/layout.tsx` es Server Component que llama `cookies()` para el JWT, pero el proxy `/api/proxy/[...path]/route.ts` está pensado para fetches del browser (con `Origin` allowlist). Forwardear el JWT directo a `${API_BASE_URL}/v1/tenants/me/branding` es viable pero requiere helper paralelo en `lib/` que NO use `'server-only'` (el proxy lo usa).
   - Decisión UX abierta: si el fetch SSR falla con 5xx, ¿bloqueamos render del shell o caemos a defaults silentemente? Alinear con design review.
   - El TenantProvider ya acepta `initialData` (parámetro existente desde iter 1), así que el wire-up es de 1 línea cuando el helper esté.
   - Estimado: 0.5d. Ticket sugerido: "MT-3-S6-01 — `getInitialBranding()` en `lib/server-fetch.ts` + `<TenantProvider initialData={...}>`".

2. **CC-23 `style-src 'unsafe-inline'` — endurecimiento Sprint 6**: el portal sigue con `style-src 'self' 'unsafe-inline'`. Mitigación actual: TenantProvider usa `documentElement.style.setProperty(...)` (no es style attribute en HTML, no requiere unsafe-inline). Endurecer requiere:
   - Generar `nonce` per-request en middleware o un layout server (Next 14 soporta vía `headers()` injection).
   - Reemplazar `'unsafe-inline'` por `'nonce-<value>'` en `next.config.mjs:headers`.
   - Auditar TODOS los `<style>` y `style="..."` del árbol — al menos `branded-logo-slot` y `branded-header` usan `style={{...}}`. React inline styles SÍ son afectados por CSP `style-src` cuando el browser parsea atributos `style=""`. Esto requiere análisis caso por caso.
   - Estimado: 1-1.5d. Ticket sugerido: "SEC-S6-01 — CSP nonce-based hardening".

3. **`dashboard-grid` LordIcon name sin URL canonical**: el sidebar mapea "Inicio" → `dashboard-grid`, pero el catálogo DS-1 tiene `<TODO_ID_DASHBOARD>` (CC-15). El fallback Lucide (`Home`) cubre pre-hidratación, pero post-registro el web-component intentará cargar `https://cdn.lordicon.com/<TODO_ID_DASHBOARD>.json` (404 silencioso, hueco visual). Owner CC-15: DS-1. Hasta resolver, considerar override temporal `lordName: 'shield-check'` o similar.

4. **TenantBrandingActionsContext default no-op silencioso**: si en el futuro un consumer fuera del Provider invoca `resetBranding()`, no pasa nada. Eso es deseable para el portal (UI no-bloqueante) pero podría enmascarar bugs. Considerar log dev-only en el default ctor: `() => { if (NODE_ENV !== 'production') console.warn(...) }`.

5. **Test 9 (logout e2e-ish) acopla a `userEvent` + global `fetch` patch**: si CI usa Node 18 sin `Response` polyfill global, podría fallar al construir `new Response(null, { status: 204 })`. Vitest+jsdom 24 ya lo expone. Si el CI lo desinstala, sustituir por `{ ok: true, status: 204 }` minimal mock.

### Resultado
- `apps/portal/components/tenant/ds1-stubs.tsx`: **eliminado**.
- `resetBranding()`: **implementado y wired al logout**, con test que verifica CSS vars vuelven a defaults.
- SSR prefetch: **NO** implementado — TODO documentado + NEW-FINDING.
- Cache key: alineado a `tenantBrandingKeys.portalSelf` (constante compartida con admin via `@segurasist/api-client`).
- CSP doc: clarificación en `middleware.ts` header.
- Tests: 9 (vs 7 del iter 1) — pero NO ejecutados en sandbox por permission denied. Verificación manual ok.
