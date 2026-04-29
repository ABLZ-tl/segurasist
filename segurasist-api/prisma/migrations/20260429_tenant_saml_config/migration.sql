-- S5-1 — Tenant SAML/SCIM configuration tables.
--
-- Two new tables, both 1:1 with Tenant (FK + UNIQUE on tenant_id):
--   tenant_saml_config — per-tenant IdP metadata for admin SSO.
--   tenant_scim_config — per-tenant SCIM bearer token (hashed) + flags.
--
-- We use NEW tables instead of inflating `tenants` because:
--   1) These rows are written by SUPERADMIN only; the app role
--      `segurasist_app` doesn't need read on the cert/token columns.
--   2) Cert/token rotations are independent of tenant lifecycle.
--   3) RLS policy is simpler (tenant_id is the only column the app
--      role would care about, and it's a join column).
--
-- Idempotent: every CREATE / ALTER guards with IF NOT EXISTS.

-- =========================================================================
-- 1) tenant_saml_config
-- =========================================================================
CREATE TABLE IF NOT EXISTS "tenant_saml_config" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           UUID NOT NULL UNIQUE,
  "idp_entity_id"       VARCHAR(512) NOT NULL,
  "idp_sso_url"         VARCHAR(1024) NOT NULL,
  "idp_slo_url"         VARCHAR(1024),
  "idp_x509_cert"       TEXT NOT NULL,
  "idp_metadata_url"    VARCHAR(1024),
  "attribute_map"       JSONB NOT NULL DEFAULT '{}'::jsonb,
  "enabled"             BOOLEAN NOT NULL DEFAULT false,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_saml_config_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "tenant_saml_config_enabled_idx"
  ON "tenant_saml_config" ("enabled");

-- =========================================================================
-- 2) tenant_scim_config
-- =========================================================================
CREATE TABLE IF NOT EXISTS "tenant_scim_config" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           UUID NOT NULL UNIQUE,
  "token_hash_sha256"   VARCHAR(64) NOT NULL,
  "token_last_rotated"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enabled"             BOOLEAN NOT NULL DEFAULT false,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_scim_config_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "tenant_scim_config_enabled_idx"
  ON "tenant_scim_config" ("enabled");

-- =========================================================================
-- 3) RLS — both tables follow the standard tenant-iso pattern.
--    Lookups in SCIM/SAML controllers run with `segurasist_admin` (BYPASSRLS)
--    because the bearer-token path is pre-tenant-context; this RLS still
--    protects against accidental reads from `segurasist_app`.
-- =========================================================================
ALTER TABLE "tenant_saml_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_saml_config" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "p_tenant_saml_config_select" ON "tenant_saml_config";
CREATE POLICY "p_tenant_saml_config_select" ON "tenant_saml_config"
  FOR SELECT
  USING ("tenant_id"::text = current_setting('app.current_tenant', true));

DROP POLICY IF EXISTS "p_tenant_saml_config_modify" ON "tenant_saml_config";
CREATE POLICY "p_tenant_saml_config_modify" ON "tenant_saml_config"
  FOR ALL
  USING ("tenant_id"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("tenant_id"::text = current_setting('app.current_tenant', true));

ALTER TABLE "tenant_scim_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_scim_config" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "p_tenant_scim_config_select" ON "tenant_scim_config";
CREATE POLICY "p_tenant_scim_config_select" ON "tenant_scim_config"
  FOR SELECT
  USING ("tenant_id"::text = current_setting('app.current_tenant', true));

DROP POLICY IF EXISTS "p_tenant_scim_config_modify" ON "tenant_scim_config";
CREATE POLICY "p_tenant_scim_config_modify" ON "tenant_scim_config"
  FOR ALL
  USING ("tenant_id"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("tenant_id"::text = current_setting('app.current_tenant', true));

-- =========================================================================
-- 4) Grants — defensive: the role may not exist on a fresh DB pre-apply-rls.
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'segurasist_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_saml_config" TO segurasist_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_scim_config" TO segurasist_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'segurasist_admin') THEN
    GRANT ALL PRIVILEGES ON "tenant_saml_config" TO segurasist_admin;
    GRANT ALL PRIVILEGES ON "tenant_scim_config" TO segurasist_admin;
  END IF;
END$$;

-- =========================================================================
-- 5) audit_action enum extension — saml_login_succeeded / saml_login_failed
--    + scim_user_created / scim_user_updated / scim_user_deleted.
-- =========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'saml_login_succeeded'
  ) THEN
    ALTER TYPE "audit_action" ADD VALUE 'saml_login_succeeded';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'saml_login_failed'
  ) THEN
    ALTER TYPE "audit_action" ADD VALUE 'saml_login_failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'scim_user_created'
  ) THEN
    ALTER TYPE "audit_action" ADD VALUE 'scim_user_created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'scim_user_updated'
  ) THEN
    ALTER TYPE "audit_action" ADD VALUE 'scim_user_updated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'scim_user_deleted'
  ) THEN
    ALTER TYPE "audit_action" ADD VALUE 'scim_user_deleted';
  END IF;
END$$;
