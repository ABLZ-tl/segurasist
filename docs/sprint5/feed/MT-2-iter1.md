# MT-2 iter 1 — 2026-04-28

## Plan

Implementar la UI premium del editor de branding del admin (S5 historia
multi-tenant). 2 columnas, react-hook-form + Zod, Lordicons + GSAP via
`@segurasist/ui` (stub local con TODO si DS-1 aún no publica). Tests
mín 8 en `branding-editor.spec.tsx`. Solo paths del File Ownership MT-2.

## Hechos

### Archivos creados

- `segurasist-web/apps/admin/app/(app)/settings/branding/page.tsx`
  Server Component. RBAC: `admin_segurasist` + `admin_mac` (los roles
  reales del rbac.ts; el briefing los nombra "superadmin" / "tenant_admin").
  Otros roles → `<AccessDenied />` con copy custom. `force-dynamic`.
- `segurasist-web/apps/admin/app/(app)/settings/branding/branding-client.tsx`
  Wrapper `'use client'` que recibe `tenantId` y renderiza `<BrandingEditor>`.
- `segurasist-web/apps/admin/components/branding-editor/branding-editor.tsx`
  Form principal. Layout grid 12 (form 5/12, preview 7/12 sticky). RHF
  + zodResolver, validación inline, botón Guardar disabled si `!isDirty
  || !isValid || isPending`, botón Restaurar default con `<Dialog>`
  confirmación, status pill "Actualizado hace X" con `formatDistanceToNow`
  (date-fns/locale es). Toast success/error vía `toast` de `@segurasist/ui`
  con Lordicon `checkmark-success`. GsapStagger en root + GsapFade por
  card.
- `segurasist-web/apps/admin/components/branding-editor/logo-dropzone.tsx`
  Dropzone accesible (role=button, aria-label, Enter/Space). Valida
  cliente-side: tipo (png/svg/webp), 512KB, dim ≤1024×1024 vía `Image()`
  onload (SVG se exonera de dim — jsdom-friendly + el backend re-valida
  con file-magic-bytes). Preview thumbnail con botón Eliminar. Errores
  inline (no toast). Lordicon `cloud-upload` en placeholder, `trash-bin`
  en delete.
- `segurasist-web/apps/admin/components/branding-editor/color-picker-card.tsx`
  Card con swatch circular grande, input nativo `type=color`, input text
  hex sincronizado bidireccional, badge WCAG con ratio numérico. State
  text local separado para permitir typing intermedio sin propagar al
  padre hasta que sea hex válido.
- `segurasist-web/apps/admin/components/branding-editor/preview-pane.tsx`
  Mock visual del portal: header con logo+nombre, hero card con
  tagline+botón+link, mock list. `<GsapFade key={primary-accent-logo}>`
  re-monta para "respirar" en cada cambio (stub usa
  `animate-in fade-in zoom-in-95` de tailwindcss-animate).
- `segurasist-web/apps/admin/components/branding-editor/_stubs.tsx`
  Lordicon + GsapFade + GsapStagger STUBS locales con la API exacta
  publicada por DS-1 en DISPATCH_PLAN. Cada export marca
  `TODO(MT-2 iter 2)` para que el swap a `@segurasist/ui` sea de 1 línea.
- `segurasist-web/apps/admin/components/branding-editor/_contrast.ts`
  Helper puro WCAG AA (relative luminance + ratio vs blanco). Sin deps
  externas. Reutilizable por DS-1 si quiere consolidar en `@segurasist/ui/theme`.
- `segurasist-web/apps/admin/components/branding-editor/index.ts`
  Barrel export.
- `segurasist-web/packages/api-client/src/hooks/admin-tenants.ts`
  React Query hooks: `useTenantBranding`, `useUpdateBrandingMutation`,
  `useUploadLogoMutation` (multipart con FormData — bypass del wrapper
  `api()` para no fijar `content-type: application/json`),
  `useDeleteLogoMutation`. Cache key `tenantBrandingKeys.detail(tenantId)`
  + invalidación cruzada de `portalSelf` (`/v1/tenants/me/branding`).
- `segurasist-web/apps/admin/test/integration/branding-editor.spec.tsx`
  11 tests (loading/error 2, render 3, submit 2, color picker 3, dropzone
  3, restore default 1). Mockea hooks de api-client + toast.

### Archivos modificados

- `segurasist-web/apps/admin/app/(app)/settings/page.tsx`
  Reemplazó el placeholder por un CTA "Abrir editor" → `/settings/branding`.
- `segurasist-web/packages/api-client/package.json`
  Agregó export `./hooks/admin-tenants` consistente con los demás hooks.

## NEW-FINDING

1. **Multipart wrapper missing**: el `api()` de `@segurasist/api-client`
   fija `content-type: application/json`, lo que rompe FormData (browser
   ya no calcula boundary). Usé `fetch` directo con `/api/proxy/...` para
   el upload del logo. Sugerencia para DS-1/infra cross-cut: agregar
   `apiMultipart()` o aceptar `FormData` en el wrapper detectando el body.
2. **react-hook-form** ya estaba en deps del admin (7.52.1) +
   `@hookform/resolvers` 3.9.0 + zod 3.23.8 — no hubo que instalar nada.
3. **Roles del briefing**: el brief usa "superadmin" / "tenant_admin",
   pero `apps/admin/lib/rbac.ts` los llama `admin_segurasist` y
   `admin_mac`. Adopté los nombres reales y dejé el racional en JSDoc.
4. **date-fns** está disponible transitivamente vía `@segurasist/ui`
   (lo declara en su package.json). Lo importo directamente en el
   editor; si MT-2 iter 2 quiere ser estricto, declararlo explícito
   en `apps/admin/package.json`.
5. **jsdom + `Image()`**: el test de "happy path" usa SVG porque el
   validador salta dim para SVG (jsdom no implementa `naturalWidth`
   confiable). Esto es deliberado y deja el test green sin polyfill.

## Bloqueos

Ninguno crítico para iter 1. Los stubs Lordicon/GSAP funcionan visualmente.

## Para iter 2 / cross-cutting

- **Consumir DS-1**: cuando publique `@segurasist/ui/lord-icon` y
  `@segurasist/ui/animations/{gsap-fade,gsap-stagger,page-transition}`,
  reemplazar 1 import en `_stubs.tsx` (o eliminar el archivo y
  importar directo desde `@segurasist/ui`). API-shape ya idéntica.
- **Consumir MT-1**: confirmar shape exacto de
  `GET /v1/admin/tenants/:id/branding` y respuesta del POST logo
  (`{ logoUrl }` asumido). Si MT-1 devuelve más metadata
  (mime, dims server-side), reflejarlo en `TenantBranding` y agregar
  preview con metadata enriquecida.
- **Test "submit con logo eliminar"**: actualmente solo cubrimos upload
  reject + happy path. Iter 2: testear `useDeleteLogoMutation` invocado
  desde el botón Eliminar en preview thumbnail.
- **Test e2e**: MT-4 implementará `tests/e2e/admin-branding-roundtrip.spec.ts`
  (admin guarda → portal recarga con nuevo branding). Mi UI ya emite los
  `data-testid` necesarios (`branding-displayName`, `branding-save-btn`,
  `color-picker-primary-text`, `logo-dropzone-input`,
  `branding-preview-name`, etc.).
- **Lordicon "arrow-loading" en botón Guardar**: actualmente uso el
  `loading` prop nativo del Button (Loader2 de Lucide). Iter 2: cuando
  DS-1 publique `<LordIcon name="arrow-loading">`, swap dentro del
  Button o passthrough.
- **Skeleton mejor**: reemplazar el skeleton genérico por un mock con
  shape exacto del editor (cards "fake" con bordes y dimensiones
  reales) para evitar layout shift al cargar.
- **Cross-cutting con MT-3**: la cache key `tenantBrandingKeys.portalSelf`
  (`['tenant-branding-self']`) la invalido en cada mutación; MT-3
  debe usar exactamente ese key en su `useTenantBranding` del portal
  para que el invalidate cruzado funcione.
- **CSP**: el preview pane usa `style={{ backgroundImage: url(...) }}`
  inline. Vive en admin (no portal) → CSP permite `style-src 'self' 'unsafe-inline'`
  ahí. En el portal real (MT-3) hay que ir por CSS vars con nonce.
