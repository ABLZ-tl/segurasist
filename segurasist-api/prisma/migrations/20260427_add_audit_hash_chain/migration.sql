-- Audit log hash chain (Sprint 1 hardening final).
--
-- Cada fila lleva:
--   prev_hash CHAR(64) — hex SHA-256 del row_hash de la fila anterior por tenant.
--                        Primera fila por tenant usa '0' * 64 como génesis.
--   row_hash  CHAR(64) — hex SHA-256 sobre la concatenación canónica de
--                        prev_hash || tenantId || actorId || action ||
--                        resourceType || resourceId || JSON canónico(payloadDiff) ||
--                        occurredAt.toISOString()
--
-- Generación: app-side (AuditWriterService). NO triggers DB → explícito y
-- testeable.
--
-- Compatibilidad con filas existentes:
--   - Defaultamos a '0' * 64 para que el ALTER aplique sobre filas previas
--     sin perder data. Las filas legacy quedan con un row_hash placeholder
--     hasta que un script de seed las re-hash; el endpoint verify-chain
--     reportará valid=false hasta que se haga el rehash.
--   - El default se DROPEA después del backfill: nuevos inserts deben pasar
--     valor explícito (defensa contra writes que olviden el hash).
--   - Si querés rehashear filas legacy: ver scripts/audit-rehash-legacy.ts.

ALTER TABLE "audit_log"
  ADD COLUMN IF NOT EXISTS "prev_hash" CHAR(64) NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN IF NOT EXISTS "row_hash"  CHAR(64) NOT NULL DEFAULT repeat('0', 64);

-- Drop default — los nuevos inserts deben llevar valor explícito (writer).
ALTER TABLE "audit_log" ALTER COLUMN "prev_hash" DROP DEFAULT;
ALTER TABLE "audit_log" ALTER COLUMN "row_hash"  DROP DEFAULT;
