-- C-09 / Sprint 4 (B-INFRA-SQS) — idempotencia DB-side para creación de insureds.
--
-- Contexto:
--   Antes de Sprint 4, `BatchesService.confirm()` intentaba garantizar
--   "exactly-once" pasando `MessageDeduplicationId` a SqsService.sendMessage.
--   Pero las colas reales son **standard** (NO FIFO), así que SQS lo ignora
--   silently (LocalStack tolera; AWS real responde InvalidParameterValue).
--   ADR-016 mueve la garantía de exactly-once al UNIQUE de DB.
--
-- Estrategia:
--   1) Tabla `batch_processed_rows`: tracking append-only por `(tenant_id,
--      batch_id, row_number)`. El worker `InsuredsCreationWorker` hace un
--      `INSERT … ON CONFLICT DO NOTHING` ANTES de crear el insured. Si el
--      INSERT no afectó filas (la fila ya existía → re-entrega SQS), el
--      worker descarta el mensaje sin side-effects.
--   2) Partial UNIQUE sobre `email_events (message_id, event_type)` cuando
--      `message_id IS NOT NULL`. Garantiza que aunque SNS reentregue el mismo
--      bounce/delivery, sólo persistimos UN evento → previene doble
--      degradación de `insureds.email` en hard bounces (H-12 / H-13 hardening).
--
-- Coordinación con F4 / F6:
--   - F4 es dueño del worker `InsuredsCreationWorker` y del schema.prisma
--     section `Batch`. F4 actualizará el worker en su iter para que use esta
--     tabla (ver feed: F5 → F4 NEW-FINDING).
--   - F6 (audit) puede registrar la deduplicación como AuditAction si quiere
--     trazabilidad (no obligatorio).
--
-- Idempotencia de la migración: usamos `IF NOT EXISTS` para que correrla 2
-- veces no falle (defensa contra el bug A2-01 de drift apply-rls.sh).

-- =====================================================================
-- 1) batch_processed_rows — guard de exactly-once para insureds creation
-- =====================================================================

CREATE TABLE IF NOT EXISTS "batch_processed_rows" (
  "tenant_id"    UUID         NOT NULL,
  "batch_id"     UUID         NOT NULL,
  "row_number"   INTEGER      NOT NULL,
  "insured_id"   UUID,
  "processed_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT "batch_processed_rows_pk"
    PRIMARY KEY ("tenant_id", "batch_id", "row_number")
);

-- Lookup por batch para reportes / cancelación.
CREATE INDEX IF NOT EXISTS "batch_processed_rows_by_batch"
  ON "batch_processed_rows" ("tenant_id", "batch_id");

-- Lookup por insured (auditoría: qué batch produjo este insured).
CREATE INDEX IF NOT EXISTS "batch_processed_rows_by_insured"
  ON "batch_processed_rows" ("tenant_id", "insured_id")
  WHERE "insured_id" IS NOT NULL;

COMMENT ON TABLE  "batch_processed_rows" IS
  'C-09 idempotency guard: workers check ON CONFLICT DO NOTHING before creating insureds.';
COMMENT ON COLUMN "batch_processed_rows"."insured_id" IS
  'NULL si el row falló validación post-claim (rollback parcial); el PK sigue siendo el lock.';

-- =====================================================================
-- 2) email_events — partial UNIQUE para prevenir doble side-effect en
--    re-entregas SNS (H-12 / H-13 hardening).
-- =====================================================================
--
-- SES asigna `messageId` único por destinatario. Si SNS reentrega el evento
-- (caso real: ~0.01% del tráfico AWS), el insert previo gana y el segundo
-- explota con ON CONFLICT — el ses-webhook controller lo captura como
-- duplicate-no-op.
--
-- IMPORTANT: este UNIQUE NO debe romper el flow Mailpit local (donde varios
-- emails comparten `messageId=null` durante dev). El predicado
-- `WHERE message_id IS NOT NULL` lo evita.

CREATE UNIQUE INDEX IF NOT EXISTS "email_events_message_id_event_type_unique"
  ON "email_events" ("tenant_id", "message_id", "event_type")
  WHERE "message_id" IS NOT NULL;

COMMENT ON INDEX "email_events_message_id_event_type_unique" IS
  'H-12/H-13: prevent SNS replay from triggering duplicate hard-bounce side-effects (insureds.email = NULL twice).';
