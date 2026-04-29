-- Sprint 5 — MT-1 Tenant branding (multi-tenant gestionable desde admin).
--
-- Extiende la tabla `tenants` con metadata de branding (display name comercial
-- + tagline + logo CDN URL + colores hex + bg image). Estos campos los expone
-- el endpoint INSURED `GET /v1/tenants/me/branding` (consumido por el portal)
-- y los muta el ADMIN `PUT/POST/DELETE /v1/admin/tenants/:id/branding`.
--
-- Decisiones:
--   - Todos los campos son NULLABLE; el resolver del backend aplica fallback
--     ("SegurAsist" / hex defaults / null logo) al leer. Esto evita un
--     backfill forzoso de 1+N rows en producción y hace la migración
--     idempotente / re-runneable en local-dev.
--   - `display_name` es VARCHAR(80) — fits "Hospitales MAC", "GNP Asistencia",
--     etc. con margen. `tagline` VARCHAR(160) (~ tweet largo, una línea).
--   - URLs hasta 512 chars (CloudFront URL + cache-busting query string +
--     locale path; con margen para el bucket name + tenantId/logo-{ts}.{ext}).
--   - Hex VARCHAR(7) = `#RRGGBB`. La validación regex
--     `^#[0-9a-fA-F]{6}$` corre en Zod (rechazo en boundary HTTP) — no
--     replicamos a CHECK constraint para no acoplar la BD a la regla de
--     formato (los valores legados "Demo123" no existen — feature nueva).
--   - `branding_updated_at` es distinto a `updated_at` global del tenant:
--     sólo se bumpea cuando un mutador de branding corre. El service en
--     PUT/POST logo/DELETE logo lo actualiza explícitamente. Permite
--     `If-Modified-Since` cache headers en el endpoint insured (Sprint 6).
--
-- Sin RLS aquí: la tabla `tenants` es el catálogo (no tiene política
-- por-tenant). El acceso queda gated por `assertPlatformAdmin` en el
-- controller admin, y el endpoint insured usa `req.tenant.id` del JWT
-- (no acepta override de path-param para usuarios no-superadmin).
--
-- También extendemos el enum `audit_action` con `tenant_branding_updated`
-- para que las mutaciones del editor de branding queden tipificadas en
-- audit_log (queries "todos los cambios de branding del último mes" son
-- un WHERE simple sin scan de payload_diff).

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "display_name" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "tagline" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "branding_logo_url" VARCHAR(512),
  ADD COLUMN IF NOT EXISTS "branding_primary_hex" VARCHAR(7),
  ADD COLUMN IF NOT EXISTS "branding_accent_hex" VARCHAR(7),
  ADD COLUMN IF NOT EXISTS "branding_bg_image_url" VARCHAR(512),
  ADD COLUMN IF NOT EXISTS "branding_updated_at" TIMESTAMP(3);

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'tenant_branding_updated';
