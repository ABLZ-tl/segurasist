# RB-021 — Onboarding de branding por tenant

**Owner**: Tenant Success + DevOps
**Trigger**: alta de un nuevo tenant (aseguradora) o solicitud de actualización de identidad visual
**Pre-req runbook**: RB-002 (alta tenant via admin) — el tenant debe existir antes de configurar branding
**Última revisión**: 2026-04-29

## 1. Contexto

A partir de Sprint 5, el portal del asegurado consume branding por tenant desde `GET /v1/tenants/me/branding`. El admin (`admin_segurasist` o `admin_mac` con tenant en contexto) puede gestionar logo, colores y mensajería desde `/settings/branding`.

Endpoints involucrados:

- `GET /v1/admin/tenants/:id/branding` — leer branding actual
- `PUT /v1/admin/tenants/:id/branding` — actualizar `displayName`, `tagline`, `primaryHex`, `accentHex`, `bgImageUrl`
- `POST /v1/admin/tenants/:id/branding/logo` (multipart) — subir logo (PNG/SVG/WebP, max 512KB, dim ≤1024×1024)
- `DELETE /v1/admin/tenants/:id/branding/logo` — restaurar placeholder default

Bucket: `segurasist-tenant-branding-{env}` con CloudFront distribution. CSP del portal permite `*.cloudfront.net` (ver `apps/portal/next.config.mjs`).

## 2. Pre-requisitos

- [ ] Tenant existe (vía RB-002).
- [ ] Operador tiene rol `admin_segurasist` o `admin_mac` con `current_tenant_id` apropiado.
- [ ] Activos del tenant disponibles:
  - Logo en formato PNG (preferido), SVG (con `<title>` para a11y) o WebP.
  - Dimensiones ≤ 1024×1024 px, peso ≤ 512KB.
  - Hex primario y acento (se valida contraste WCAG AA contra blanco — si falla, badge warning en UI).
  - Tagline opcional (≤160 chars).
- [ ] Si se va a publicar en producción: aprobación marketing/legal por escrito (Slack #brand-approvals con enlace al issue Linear).

## 3. Procedimiento (admin UI — happy path)

1. Login en `https://admin.segurasist.app` (o staging equivalente).
2. Si superadmin: usar `<TenantSwitcher>` en header para cambiar a tenant target.
3. Ir a **Configuración → Branding** (`/settings/branding`).
4. Subir logo arrastrando al dropzone (o click → seleccionar archivo).
   - Si rechaza por tamaño/dim/MIME, ajustar el archivo y reintentar.
5. Ajustar `displayName` y `tagline`.
6. Cambiar `primaryHex` y `accentHex` (input nativo + text hex sync).
   - Vigilar el badge **Contraste WCAG**. Si dice "Bajo", elegir un hex con luminance ratio ≥ 4.5 contra blanco.
7. Verificar el **Preview pane** lateral — el header, hero card, botón y link reflejan los nuevos valores.
8. Click **Guardar**. Esperar toast `success` con Lordicon `checkmark-success`.
9. Verificar propagación al portal:
   - En ventana incógnita, login como insured del mismo tenant.
   - Header debe mostrar logo + displayName actualizados.
   - CSS var `--tenant-primary` debe contener el hex (`document.documentElement.style.getPropertyValue('--tenant-primary')`).

## 4. Verificación E2E

Disponible: `pnpm --filter root test:e2e tests/e2e/admin-branding-roundtrip.spec.ts` (cuando MT-4 quite los `it.skip` post-iter 2).

## 5. Rollback

- Para restaurar branding default (placeholder SegurAsist): UI → **Restaurar default** (modal de confirmación).
- Para revertir a un branding previo: aún no existe historial visual (Sprint 6+). Workaround: pedir al cliente los assets anteriores y re-subirlos.

## 6. Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| Logo no aparece en portal tras guardar | Cache CloudFront 1h | Esperar TTL o invalidar via `aws cloudfront create-invalidation --paths "/{tenantId}/*"` |
| Toast "Logo demasiado grande" | >512KB o dim >1024×1024 | Reducir con TinyPNG / `sharp` CLI |
| Toast "Tipo no soportado" | MIME ≠ png/svg/webp **o** file-magic-bytes mismatch | Verificar el header del archivo (`file logo.png`) |
| Preview no actualiza color | Browser dev cache CSS | Hard reload (Ctrl+Shift+R) |
| Cross-Origin-Resource-Policy bloqueado en `<img>` | El bucket no responde con `cross-origin` CORP header | Re-aplicar Terraform `s3-tenant-branding`; verificar `s3_bucket_policy` |
| Insured sigue viendo branding antiguo | CSS vars cacheadas en sessionStorage | TenantProvider tiene `staleTime 5min`. Cierre/abre pestaña o force `queryClient.invalidateQueries(['tenant-branding-self'])` |

## 7. Audit

Toda mutación emite `AuditLog` con `action: 'tenant_branding_updated'` (o `_logo_uploaded` / `_logo_deleted`) y `payloadDiff` con campos modificados. Ver Vista 360 del tenant en admin.

## 8. Onboarding masivo (bulk)

Para >5 tenants nuevos: usar script `scripts/branding-bulk-import.ts` (TODO Sprint 6) o procedimiento manual repitiendo los pasos 1-9.

## 9. Cross-references

- ADR-0013 (Brandable Theming)
- DEVELOPER_GUIDE.md (sección branding cookbook)
- `segurasist-infra/modules/s3-tenant-branding/main.tf`
- `segurasist-api/src/modules/tenants/branding/`
- `segurasist-web/apps/portal/components/tenant/tenant-provider.tsx`
