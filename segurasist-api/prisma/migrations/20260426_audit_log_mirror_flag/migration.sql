-- Audit log → S3 mirror tracking (Sprint 2 — story S2-07).
--
-- Defensa en profundidad: el audit_log vive en Postgres con hash chain, pero
-- Postgres es restorable (no inmutable). Espejamos asíncronamente cada fila a
-- S3 (LocalStack en dev, S3 mx-central-1 en Sprint 5) con Object Lock
-- COMPLIANCE 730 días.
--
-- `mirrored_to_s3` arranca FALSE para todas las filas (incluyendo histórico).
-- Un worker batched (`AuditS3MirrorService`) lee cada minuto las filas con
-- mirrored_to_s3=false agrupadas por (tenant_id, fecha), sube NDJSON a S3 y
-- marca las filas como mirrored.
--
-- Index parcial: optimiza el query del worker (`WHERE mirrored_to_s3=false`).
-- Cuando se cierra el backlog, el index queda virtualmente vacío → cost zero
-- en INSERT/UPDATE de filas ya replicadas.

ALTER TABLE "audit_log"
  ADD COLUMN IF NOT EXISTS "mirrored_to_s3" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "mirrored_at"    TIMESTAMP(3) NULL;

-- Partial index: solo indexa filas pendientes de mirror. Acelera el SELECT
-- del worker sin pagar costo de mantenimiento sobre el grueso del audit_log
-- (que ya está mirrored y no necesita ser visitado).
CREATE INDEX IF NOT EXISTS "audit_log_mirror_idx"
  ON "audit_log" ("tenant_id", "occurred_at")
  WHERE "mirrored_to_s3" = FALSE;
