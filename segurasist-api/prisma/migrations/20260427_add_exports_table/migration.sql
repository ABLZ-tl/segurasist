-- S3-09 — tabla `exports` para tracking asíncrono de jobs XLSX/PDF.
--
-- Diseño:
--   - `id` UUID generado en backend (no DB default) para que el response
--     async pueda devolverlo antes de que el worker termine.
--   - `status` enum tipado: pending → processing → ready | failed.
--     Transiciones unidireccionales; la app valida transiciones, la DB
--     no usa CHECK porque el enum ya restringe valores válidos.
--   - `filters` JSONB inmutable post-create (snapshot del request original
--     para reproducibilidad y forensics).
--   - `s3_key` y `hash` SHA-256 del file final, sólo cuando status='ready'.
--   - `error` mensaje human-readable cuando status='failed'.
--   - `requested_at` siempre seteado (default now()).
--     `completed_at` set por el worker al final (incluyendo failed).
--   - Index `(tenant_id, status)` para que el guard de "10/day por tenant"
--     pueda contar rápido los pending+ready+failed del día.
--   - Index `(tenant_id, requested_by, requested_at DESC)` para el listado
--     "mis exports" de un user.
--   - RLS: política tenant-iso usando `app.current_tenant`. El worker corre
--     con BYPASSRLS (rol segurasist_admin) y por tanto NO necesita SET.

CREATE TYPE "export_status" AS ENUM ('pending', 'processing', 'ready', 'failed');

CREATE TABLE "exports" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "requested_by" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "filters" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" "export_status" NOT NULL DEFAULT 'pending',
  "row_count" INT NULL,
  "s3_key" TEXT NULL,
  "hash" TEXT NULL,
  "error" TEXT NULL,
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMPTZ NULL,
  CONSTRAINT "exports_format_check" CHECK ("format" IN ('xlsx', 'pdf')),
  CONSTRAINT "exports_kind_check" CHECK ("kind" IN ('insureds')),
  CONSTRAINT "exports_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
);

CREATE INDEX "exports_tenant_status_idx" ON "exports" ("tenant_id", "status");
CREATE INDEX "exports_requester_idx" ON "exports" ("tenant_id", "requested_by", "requested_at" DESC);
CREATE INDEX "exports_tenant_requested_at_idx" ON "exports" ("tenant_id", "requested_at" DESC);

-- =========================================================================
-- RLS — política tenant-iso. El rol segurasist_app NOBYPASSRLS sólo ve
-- exports de su tenant; el writer del worker usa segurasist_admin BYPASSRLS.
-- =========================================================================
ALTER TABLE "exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exports" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "p_exports_select" ON "exports";
CREATE POLICY "p_exports_select" ON "exports"
  FOR SELECT
  USING ("tenant_id"::text = current_setting('app.current_tenant', true));

DROP POLICY IF EXISTS "p_exports_modify" ON "exports";
CREATE POLICY "p_exports_modify" ON "exports"
  FOR ALL
  USING ("tenant_id"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("tenant_id"::text = current_setting('app.current_tenant', true));

-- Grants para los roles RLS estándar (idempotente: si el rol no existe
-- todavía -- p.ej. una DB recién creada antes de apply-rls.sh -- usamos
-- DO block defensivo).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'segurasist_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "exports" TO segurasist_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'segurasist_admin') THEN
    GRANT ALL PRIVILEGES ON "exports" TO segurasist_admin;
  END IF;
END$$;
