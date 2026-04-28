-- S4-04 — Tabla `monthly_report_runs` (idempotencia DB-side del cron mensual).
--
-- Diseño:
--   - `id` UUID generado en backend (no DB default) por consistencia con `exports`.
--   - UNIQUE natural key `(tenant_id, period_year, period_month)` ⇒ P2002 al
--     re-disparar el cron para el mismo período evita re-emitir email.
--   - `status` enum tipado: pending → processing → completed | failed.
--   - `period_month` con CHECK 1..12 (defensa runtime ante bugs en el handler).
--   - `triggered_by` VARCHAR(32) discrimina cron real vs re-trigger manual.
--   - Indexes por (tenant_id, triggered_at DESC) y (status, triggered_at DESC)
--     para queries del dashboard de ops + filtros tipo "todos los failed".
--   - RLS: política tenant-iso usando `app.current_tenant`. Handler usa
--     BYPASSRLS (worker, sin req).

CREATE TYPE "monthly_report_status" AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE "monthly_report_runs" (
  "id" UUID PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "period_year" INT NOT NULL,
  "period_month" INT NOT NULL,
  "status" "monthly_report_status" NOT NULL DEFAULT 'pending',
  "s3_key" TEXT NULL,
  "recipient_count" INT NULL,
  "email_message_id" TEXT NULL,
  "error_message" TEXT NULL,
  "triggered_by" VARCHAR(32) NOT NULL DEFAULT 'eventbridge',
  "triggered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMPTZ(3) NULL,
  CONSTRAINT "monthly_report_runs_period_month_check" CHECK ("period_month" BETWEEN 1 AND 12),
  CONSTRAINT "monthly_report_runs_period_year_check" CHECK ("period_year" BETWEEN 2024 AND 2100),
  CONSTRAINT "monthly_report_runs_triggered_by_check" CHECK ("triggered_by" IN ('eventbridge', 'manual')),
  CONSTRAINT "monthly_report_runs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
);

-- IDEMPOTENCIA: la UNIQUE es la columna vertebral del feature. Cualquier
-- intento de `INSERT` duplicado lanza UNIQUE_VIOLATION (Postgres 23505 →
-- Prisma P2002), que el handler captura para `skip`.
CREATE UNIQUE INDEX "monthly_report_run_period_unique"
  ON "monthly_report_runs" ("tenant_id", "period_year", "period_month");

CREATE INDEX "monthly_report_runs_tenant_triggered_idx"
  ON "monthly_report_runs" ("tenant_id", "triggered_at" DESC);

CREATE INDEX "monthly_report_runs_status_idx"
  ON "monthly_report_runs" ("status", "triggered_at" DESC);

-- =========================================================================
-- RLS — tenant-iso. El rol `segurasist_app` NOBYPASSRLS sólo ve runs de su
-- tenant; el worker (handler) usa `segurasist_admin` BYPASSRLS para iterar
-- cross-tenant. Ambas políticas (SELECT + ALL) usan `app.current_tenant`.
-- =========================================================================
ALTER TABLE "monthly_report_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monthly_report_runs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "p_monthly_report_runs_select" ON "monthly_report_runs";
CREATE POLICY "p_monthly_report_runs_select" ON "monthly_report_runs"
  FOR SELECT
  USING ("tenant_id"::text = current_setting('app.current_tenant', true));

DROP POLICY IF EXISTS "p_monthly_report_runs_modify" ON "monthly_report_runs";
CREATE POLICY "p_monthly_report_runs_modify" ON "monthly_report_runs"
  FOR ALL
  USING ("tenant_id"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("tenant_id"::text = current_setting('app.current_tenant', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'segurasist_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "monthly_report_runs" TO segurasist_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'segurasist_admin') THEN
    GRANT ALL PRIVILEGES ON "monthly_report_runs" TO segurasist_admin;
  END IF;
END$$;
