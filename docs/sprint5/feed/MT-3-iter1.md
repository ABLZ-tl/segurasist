## [MT-3 iter 1] 2026-04-28

### Plan
Cerrar el gap "portal asegurado sin multi-tenant awareness en FE" usando el contrato `GET /v1/tenants/me/branding` que MT-1 publica esta misma iter. Entrega: TenantContext + Provider con SWR, `<BrandedHeader/Footer/Sidebar>`, CSS vars dinámicas CSP-safe, integración test, hint E2E para MT-4.

### Hechos
Archivos NUEVOS:
- `segurasist-web/apps/portal/components/tenant/tenant-context.tsx` — React Context + `DEFAULT_TENANT_BRANDING` (verde MAC `#16a34a`, violeta `#7c3aed`).
- `segurasist-web/apps/portal/components/tenant/tenant-provider.tsx` — `useQuery(['tenant-branding','me'])`, staleTime 5min, gcTime 10min, retry 1 (excepto 401). 401 → `router.replace('/login')`. 5xx → defaults + `toast.message`. Aplica branding al DOM con `documentElement.style.setProperty('--tenant-primary-hex', ...)` (CSP-safe, no inline-style HTML attr). Parsea defensivamente con regex `^#[0-9a-fA-F]{6}$` y URL whitelist (solo http/https).
- `segurasist-web/apps/portal/components/tenant/ds1-stubs.tsx` — stubs locales de `<LordIcon>`, `<GsapFade>`, `<PageTransition>` con la misma signature que DS-1 publicará. TODO claro para borrar en iter 2.
- `segurasist-web/apps/portal/lib/hooks/use-tenant-branding.ts` — hook tipado con guard de provider missing.
- `segurasist-web/apps/portal/components/layout/branded-header.tsx` — header con logo dinámico (img CDN o LordIcon fallback), shadow soft, radius 12px, `<GsapFade>` entrada, hover micro-interaction.
- `segurasist-web/apps/portal/components/layout/branded-footer.tsx` — tagline + año + links Aviso/Términos.
- `segurasist-web/apps/portal/components/layout/branded-sidebar.tsx` — visible solo `md+` (mobile sigue con bottom-nav). Lordicons por item.
- `segurasist-web/apps/portal/test/integration/tenant-provider.spec.tsx` — 7 tests (loading, success+CSS vars, logo img, fallback LordIcon, 401 redirect, 5xx + toast, hex inválido).
- `tests/e2e/multi-tenant-portal.spec.ts` — placeholder con 3 `it.skip` y TODO para MT-4.

Archivos MODIFICADOS:
- `apps/portal/app/(app)/layout.tsx` — envuelto en `<TenantProvider>` + `<PageTransition>` + `<BrandedSidebar>`. El legacy `<PortalHeader>` ya no se usa (archivo y test unit se preservan, no rotos).
- `apps/portal/app/globals.css` — vars `--tenant-primary-hex/rgb`, `--tenant-accent-hex/rgb`, `--tenant-bg-image`, `--tenant-logo-url`.
- `apps/portal/tailwind.config.ts` — extendido con `colors.tenant.{primary,accent}` y `backgroundImage.tenant-bg/logo`. NO duplica preset.
- `apps/portal/next.config.mjs` — `img-src` extendido con `NEXT_PUBLIC_BRANDING_CDN ?? 'https://*.cloudfront.net'`.

### Dependencias
- **MT-1**: contrato `GET /v1/tenants/me/branding` con shape `{ tenantId, displayName, tagline, logoUrl, primaryHex, accentHex, bgImageUrl, lastUpdatedAt }`. El provider parsea defensivamente — si MT-1 publica con campos extra/null, no rompe. Si cambia nombres de campos antes de iter 2, hay que ajustar `BrandingApiResponse` en `tenant-provider.tsx`.
- **MT-1**: dominio CDN exacto del módulo `s3-tenant-branding`. Por ahora `*.cloudfront.net` cubre, pero un dominio dedicado (ej `branding.segurasist.app`) requiere actualizar `NEXT_PUBLIC_BRANDING_CDN` en `.env.local` y redeploy.
- **DS-1**: `<LordIcon>`, `<GsapFade>`, `<PageTransition>` desde `@segurasist/ui`. En iter 1 uso stubs locales con la misma signature acordada en DISPATCH §"Contratos a publicar". Iter 2: borrar `ds1-stubs.tsx`, reemplazar imports.
- **MT-4**: usa los `data-testid` estables que dejé (`portal-branded-header`, `branded-display-name`, `branded-logo-img`, `branded-tagline`, `portal-branded-footer`, `portal-branded-sidebar`).

### NEW-FINDING
1. **CSP gap descubierto**: el dispatch decía "extender `middleware.ts`" pero las reglas CSP del portal viven en `next.config.mjs` (`async headers()`), NO en middleware. El middleware solo valida origin/cookie. Hubo que extender `next.config.mjs:imgSrc`. Documentar en `DEVELOPER_GUIDE` si no está ya.
2. **`unsafe-inline` en style-src**: el portal ya tiene `style-src 'self' 'unsafe-inline'`. Esto significa que técnicamente PODRÍAMOS usar `<style>` tag con tenant CSS, pero `setProperty` evita la dependencia de `unsafe-inline` y nos pone en posición de poder endurecer CSP en Sprint 6 (`style-src 'self' 'nonce-...'`) sin tocar el TenantProvider.
3. **`require-corp`**: el portal usa `Cross-Origin-Embedder-Policy: require-corp`. Logos venidos del CDN tenant DEBEN servirse con header `Cross-Origin-Resource-Policy: cross-origin` o `same-site` — coordinar con MT-1 (`s3-tenant-branding` CloudFront response-headers-policy).
4. **Sidebar vs bottom-nav**: el portal mobile NO tiene sidebar — usa `<PortalBottomNav>`. `branded-sidebar.tsx` lo dejé como `hidden md:flex` para desktop, pero confirmar con producto si quieren reducir scope (pueden no consumirlo).
5. **Legacy `<PortalHeader>` no eliminado**: lo mantengo en árbol (test unit existente sigue verde). Sprint 6: limpiar.

### Bloqueos
- Permission denied al ejecutar `pnpm test:unit` desde mi sandbox — los 7 tests del spec quedan no-ejecutados localmente. Confirmar verde en CI / orchestrator. Lógica revisada manualmente; las dependencias mockeadas (`__routerStub`, `toast`, `fetcher` override) están alineadas con `vitest.setup.ts`.

### Para iter 2 / cross-cutting
- Borrar `components/tenant/ds1-stubs.tsx` y migrar imports a `@segurasist/ui` cuando DS-1 publique.
- Implementar páginas `/legal/privacy` y `/legal/terms` (los links del footer apuntan ahí pero no existen aún — owner posiblemente DS-1 o equipo legal/contenido).
- Verificar contraste WCAG AA dinámico: si el tenant elige `primaryHex` con bajo contraste contra `bg`, mostrar warning. Backend ya valida hex format pero no contraste — eso es UX-side.
- Endurecer `style-src` quitando `'unsafe-inline'` con nonce server-set (Sprint 6 candidate).
- Coordinar con MT-1 que el response del CDN incluya `Cross-Origin-Resource-Policy: cross-origin` para que `require-corp` no bloquee `<img>`.
- Opcional: pre-fetch del branding endpoint en el server component del layout para evitar el flash inicial (SSR initial data).
