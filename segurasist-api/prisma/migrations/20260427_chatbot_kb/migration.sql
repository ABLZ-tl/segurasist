-- S4-06 — Chatbot KB structure + matching engine + admin CRUD.
--
-- Cambios:
--   1) Nuevo enum chat_conversation_status (active|escalated|closed).
--   2) Nueva tabla chat_conversations (1:N mensajes por insured).
--   3) Tabla chat_messages — agrega columnas conversation_id, role,
--      matched_entry_id (FK soft a chat_kb.id) + índice compuesto.
--   4) Tabla chat_kb — agrega columnas keywords (text[]), synonyms (jsonb),
--      priority (int), enabled (bool) + índice por enabled.
--   5) RLS: las 3 tablas siguen el patrón tenant-iso. chat_messages y chat_kb
--      ya tenían RLS habilitado en las policies globales — re-emitimos sus
--      grants y agregamos el bootstrap nuevo para chat_conversations. La
--      lista canónica vive en `prisma/rls/policies.sql` (ver array tables).
--
-- Idempotencia: usamos IF NOT EXISTS en CREATE/ALTER para no fallar si la
-- migración corre en una BD ya parchada (p.ej. tras un rebase con esta
-- migración aplicada manualmente).

-- =========================================================================
-- 1) Enum chat_conversation_status
-- =========================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_conversation_status') THEN
    CREATE TYPE "chat_conversation_status" AS ENUM ('active', 'escalated', 'closed');
  END IF;
END$$;

-- =========================================================================
-- 2) Tabla chat_conversations
-- =========================================================================
CREATE TABLE IF NOT EXISTS "chat_conversations" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"   UUID NOT NULL,
  "insured_id"  UUID NOT NULL,
  "status"      "chat_conversation_status" NOT NULL DEFAULT 'active',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_conversations_tenant_fk" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id")
);

CREATE INDEX IF NOT EXISTS "chat_conversations_tenant_insured_status_idx"
  ON "chat_conversations" ("tenant_id", "insured_id", "status");
CREATE INDEX IF NOT EXISTS "chat_conversations_tenant_updated_at_idx"
  ON "chat_conversations" ("tenant_id", "updated_at" DESC);

-- =========================================================================
-- 3) Extender chat_messages
-- =========================================================================
ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "conversation_id"  UUID,
  ADD COLUMN IF NOT EXISTS "role"             VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "matched_entry_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_conversation_fk'
  ) THEN
    ALTER TABLE "chat_messages"
      ADD CONSTRAINT "chat_messages_conversation_fk"
      FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id");
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "chat_messages_tenant_conversation_created_idx"
  ON "chat_messages" ("tenant_id", "conversation_id", "created_at");

-- =========================================================================
-- 4) Extender chat_kb (matching engine columns)
-- =========================================================================
ALTER TABLE "chat_kb"
  ADD COLUMN IF NOT EXISTS "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "synonyms" JSONB  NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "priority" INT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "enabled"  BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "chat_kb_tenant_enabled_idx"
  ON "chat_kb" ("tenant_id", "enabled");

-- =========================================================================
-- 5) RLS — chat_conversations (chat_messages y chat_kb ya están en el array
--    canónico de policies.sql; los re-emitimos aquí también para que la
--    migración sea self-contained y `prisma migrate deploy` deje las 3 tablas
--    completas aunque `apply-rls.sh` no haya corrido).
-- =========================================================================
ALTER TABLE "chat_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_conversations" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "p_chat_conversations_select" ON "chat_conversations";
CREATE POLICY "p_chat_conversations_select" ON "chat_conversations"
  FOR SELECT
  USING ("tenant_id"::text = current_setting('app.current_tenant', true));

DROP POLICY IF EXISTS "p_chat_conversations_modify" ON "chat_conversations";
CREATE POLICY "p_chat_conversations_modify" ON "chat_conversations"
  FOR ALL
  USING ("tenant_id"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("tenant_id"::text = current_setting('app.current_tenant', true));

-- chat_messages: re-emit por completitud (idempotente).
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_messages" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "p_chat_messages_select" ON "chat_messages";
CREATE POLICY "p_chat_messages_select" ON "chat_messages"
  FOR SELECT
  USING ("tenant_id"::text = current_setting('app.current_tenant', true));

DROP POLICY IF EXISTS "p_chat_messages_modify" ON "chat_messages";
CREATE POLICY "p_chat_messages_modify" ON "chat_messages"
  FOR ALL
  USING ("tenant_id"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("tenant_id"::text = current_setting('app.current_tenant', true));

-- chat_kb: re-emit por completitud (idempotente).
ALTER TABLE "chat_kb" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_kb" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "p_chat_kb_select" ON "chat_kb";
CREATE POLICY "p_chat_kb_select" ON "chat_kb"
  FOR SELECT
  USING ("tenant_id"::text = current_setting('app.current_tenant', true));

DROP POLICY IF EXISTS "p_chat_kb_modify" ON "chat_kb";
CREATE POLICY "p_chat_kb_modify" ON "chat_kb"
  FOR ALL
  USING ("tenant_id"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("tenant_id"::text = current_setting('app.current_tenant', true));

-- =========================================================================
-- 6) Grants para los roles RLS estándar (defensivo: el rol puede no existir
--    aún si la BD se acaba de crear sin haber corrido apply-rls.sh).
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'segurasist_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "chat_conversations" TO segurasist_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "chat_messages" TO segurasist_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "chat_kb" TO segurasist_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'segurasist_admin') THEN
    GRANT ALL PRIVILEGES ON "chat_conversations" TO segurasist_admin;
    GRANT ALL PRIVILEGES ON "chat_messages" TO segurasist_admin;
    GRANT ALL PRIVILEGES ON "chat_kb" TO segurasist_admin;
  END IF;
END$$;
