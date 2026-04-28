-- SegurAsist — RLS bootstrap (post-migrate)
-- Idempotent. Ejecutar DESPUÉS de `prisma migrate deploy` con un superuser.
-- En local: `./scripts/apply-rls.sh` lo aplica usando el postgres del docker-compose.
-- En prod: lo ejecuta el job de pre-deploy o un Lambda one-shot bajo `segurasist_admin`.
--
-- Este script:
--   (1) crea los roles segurasist_app (sin BYPASSRLS) y segurasist_admin (con BYPASSRLS).
--   (2) habilita RLS en cada tabla con tenant_id.
--   (3) crea políticas USING (SELECT) y WITH CHECK (INSERT/UPDATE/DELETE)
--       basadas en current_setting('app.current_tenant', true).

-- =========================================================================
-- 1) Roles
-- =========================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'segurasist_app') THEN
    CREATE ROLE segurasist_app LOGIN PASSWORD 'CHANGE_ME_IN_SECRETS_MANAGER' NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'segurasist_admin') THEN
    CREATE ROLE segurasist_admin LOGIN PASSWORD 'CHANGE_ME_IN_SECRETS_MANAGER' BYPASSRLS;
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO segurasist_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO segurasist_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO segurasist_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO segurasist_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO segurasist_app;

GRANT ALL PRIVILEGES ON SCHEMA public TO segurasist_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO segurasist_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO segurasist_admin;

-- =========================================================================
-- 2) Helper: enable RLS + crear políticas tenant-iso para cada tabla.
--    (idempotente: drop policy if exists antes de crearla)
--
--    NOTA M2 — superadmin: `users.tenant_id` es NULLABLE. La política rejecta
--    NULL como cualquier otro mismatch (NULL = current_setting → NULL → false)
--    y eso es lo que queremos: el cliente normal `segurasist_app` jamás verá
--    al superadmin desde un contexto tenant. El superadmin se lee con el rol
--    `segurasist_admin` (BYPASSRLS) vía `PrismaBypassRlsService`.
-- =========================================================================
DO $$
DECLARE
  tbl TEXT;
  -- Lista canónica derivada de TODAS las tablas con `tenant_id` en
  -- `prisma/schema.prisma` (verificado 2026-04-27 — F3 iter 1, C-15).
  -- Si agregas una tabla con tenant_id en el schema, AGRÉGALA aquí
  -- (drift ⇒ RLS off ⇒ multi-tenant breach).
  tables TEXT[] := ARRAY[
    'users',
    'packages',
    'coverages',
    'insureds',
    'beneficiaries',
    'certificates',
    'claims',
    'coverage_usage',
    'batches',
    'batch_errors',
    'email_events',
    'chat_messages',
    'chat_kb',
    'system_alerts',  -- F3 iter1 NEW-FINDING: tenant_id NULLABLE (alertas
                      -- platform-wide). Política trata NULL = mismatch
                      -- (current_setting → NULL → false), igual que `users`
                      -- superadmin: cliente normal `segurasist_app` jamás ve
                      -- alertas globales — sólo segurasist_admin via BYPASSRLS.
    'audit_log',
    'exports'         -- C-15: faltaba aquí. Migration 20260427 sí crea la tabla
                      -- con políticas locales, pero `apply-rls.sh` re-aplicado
                      -- contra DB nueva omitía RLS en `exports` ⇒ drift.
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);

    EXECUTE format('DROP POLICY IF EXISTS p_%1$s_select ON %1$I;', tbl);
    EXECUTE format(
      'CREATE POLICY p_%1$s_select ON %1$I FOR SELECT USING (tenant_id::text = current_setting(''app.current_tenant'', true));',
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS p_%1$s_modify ON %1$I;', tbl);
    EXECUTE format(
      'CREATE POLICY p_%1$s_modify ON %1$I FOR ALL '
      || 'USING (tenant_id::text = current_setting(''app.current_tenant'', true)) '
      || 'WITH CHECK (tenant_id::text = current_setting(''app.current_tenant'', true));',
      tbl
    );
  END LOOP;
END$$;

-- =========================================================================
-- 3) Tabla `tenants`: NO se aplica RLS por tenant_id porque ES el catálogo.
--    Solo segurasist_admin puede mutarla; segurasist_app sólo SELECT.
-- =========================================================================
REVOKE INSERT, UPDATE, DELETE ON tenants FROM segurasist_app;
GRANT SELECT ON tenants TO segurasist_app;

-- =========================================================================
-- 4) Extensiones útiles (búsqueda por nombre con trigram)
-- =========================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_insureds_fullname_trgm ON insureds USING gin (full_name gin_trgm_ops);
