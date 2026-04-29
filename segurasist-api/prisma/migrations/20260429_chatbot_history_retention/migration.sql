-- Sprint 5 — S5-3 chatbot conversaciones: retención 30 días + endpoint
-- histórico self-served para insureds.
--
-- Decisiones:
--   1) `expires_at` NOT NULL con DEFAULT `now() + 30 days`. Backfill explícito
--      para las filas sembradas en Sprint 4 (defensa contra rows que el
--      DEFAULT no toca cuando la columna se agrega con `IF NOT EXISTS`).
--      Después del backfill mantenemos el DEFAULT para que el INSERT del
--      `KbService.resolveConversation` no necesite setear el campo
--      explícitamente — TZ neutral porque el DEFAULT corre dentro del cluster
--      Postgres con `now()` UTC (verificado en `db.timezone='UTC'`).
--   2) Index `chat_conversations_expires_at_idx` para que el cron de purga
--      diario haga seq scan-free incluso con N>10k filas. El plan esperado
--      es Bitmap Index Scan + Recheck — confirmado en EXPLAIN local.
--   3) NO tocamos RLS — la tabla ya está en el array policies.sql y la
--      política tenant-iso aplica al cron también: el handler corre con
--      `BYPASSRLS` (PrismaBypassRlsService) idéntico a reports/email cron,
--      por lo que el `WHERE expires_at < NOW()` cruza tenants global. ADR
--      pattern documentado en monthly-reports-handler.

ALTER TABLE "chat_conversations"
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3) NOT NULL DEFAULT (NOW() + INTERVAL '30 days');

-- Backfill defensivo: si la columna ya existía sin DEFAULT (re-run en prod),
-- forzamos a que las filas legacy queden con createdAt + 30d.
UPDATE "chat_conversations"
   SET "expires_at" = "created_at" + INTERVAL '30 days'
 WHERE "expires_at" < "created_at" + INTERVAL '1 minute';

CREATE INDEX IF NOT EXISTS "chat_conversations_expires_at_idx"
  ON "chat_conversations" ("expires_at");
