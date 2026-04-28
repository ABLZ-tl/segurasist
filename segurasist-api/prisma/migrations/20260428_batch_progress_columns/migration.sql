-- F4 Sprint 4 fix bundle B-BATCHES (C-05, C-06, C-07, C-08).
--
-- Contexto:
--   * El flujo de batches mezclaba contadores de validación (rows_ok/rows_error
--     producidos por el LayoutWorker / sync upload) con contadores de
--     procesamiento del InsuredsCreationWorker → el batch terminaba en
--     `completed` después del primer mensaje procesado (C-06).
--   * `bumpBatchCounters` lee y luego escribe en transacciones separadas →
--     TOCTOU + posible doble emisión `batch.completed` (C-07).
--   * `confirm()` con `rowsToInclude` subset → comparación contra rowsTotal
--     dejaba el batch en `processing` infinito (C-08).
--
-- Esta migración agrega columnas dedicadas para el state machine post-confirm:
--   - processed_rows / success_rows / failed_rows: contadores del worker
--     (separados de rows_ok / rows_error de la fase de validación).
--   - queued_count: número real de mensajes encolados en `confirm()` (puede
--     ser un subset de rows_ok si se usa rowsToInclude).
--   - completed_event_emitted_at: timestamp único del momento en que se emite
--     `batch.completed` — sirve como compare-and-set para garantizar emisión
--     exactly-once.
--
-- El UNIQUE index parcial sobre (id) WHERE completed_event_emitted_at IS NOT
-- NULL es defensivo: el flujo nunca debería intentar emitir dos veces, pero si
-- una segunda transacción concurrente llegase con NULL→timestamp en paralelo,
-- Postgres rechazaría la 2da actualización.

ALTER TABLE "batches" ADD COLUMN "processed_rows" INT NOT NULL DEFAULT 0;
ALTER TABLE "batches" ADD COLUMN "success_rows"   INT NOT NULL DEFAULT 0;
ALTER TABLE "batches" ADD COLUMN "failed_rows"    INT NOT NULL DEFAULT 0;
ALTER TABLE "batches" ADD COLUMN "queued_count"   INT;
ALTER TABLE "batches" ADD COLUMN "completed_event_emitted_at" TIMESTAMPTZ;

-- Defensa exactly-once: una vez seteado `completed_event_emitted_at`, no se
-- puede volver a setear (el UPDATE atómico en el worker pone una guard
-- `WHERE completed_event_emitted_at IS NULL`). Adicionalmente este índice
-- parcial garantiza unicidad a nivel storage si alguien bypassea el guard.
CREATE UNIQUE INDEX "idx_batches_completed_once"
  ON "batches" ("id")
  WHERE "completed_event_emitted_at" IS NOT NULL;
