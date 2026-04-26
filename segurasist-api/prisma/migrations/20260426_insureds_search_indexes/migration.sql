-- S2-06 — Índices de búsqueda + filtros frecuentes en `insureds`.
--
-- 1) pg_trgm extension. Ya viene desde apply-rls.sh (idempotente).
-- 2) GIN trigram para fuzzy ILIKE %q% sobre (full_name, curp, rfc).
-- 3) Índice compuesto (tenant_id, status, valid_to) para listas filtradas
--    por estado + vigencia (vencidas en próximos 30 días, etc.).
--
-- Compatibilidad: ya existe `idx_insureds_fullname_trgm` desde apply-rls.sh
-- (single-column sobre full_name). La migración crea un índice GIN
-- multi-columna que cubre full_name + curp + rfc en un solo scan, y deja
-- el legacy en su lugar (Postgres elegirá el más específico por query).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN multi-columna trigram. `IF NOT EXISTS` para idempotencia en re-runs.
-- gin_trgm_ops permite LIKE '%foo%' y similarity('a','b') sobre cada columna.
CREATE INDEX IF NOT EXISTS "insureds_search_idx"
  ON "insureds" USING gin (
    "full_name" gin_trgm_ops,
    "curp" gin_trgm_ops
  );

-- Trigram dedicado para RFC (nullable, columna pequeña).
CREATE INDEX IF NOT EXISTS "insureds_rfc_trgm_idx"
  ON "insureds" USING gin ("rfc" gin_trgm_ops)
  WHERE "rfc" IS NOT NULL;

-- Compuesto para filtros comunes: lista por tenant + status + vigencia.
-- Cubre queries del tipo:
--   WHERE tenant_id = $1 AND status = 'active' AND valid_to <= $cutoff
CREATE INDEX IF NOT EXISTS "insureds_tenant_status_validto_idx"
  ON "insureds" ("tenant_id", "status", "valid_to");

-- Índice descendente sobre created_at para cursor pagination eficiente.
-- El cursor compuesto (created_at, id) lo aprovecha:
--   WHERE (created_at, id) < ($cur_created, $cur_id)
--   ORDER BY created_at DESC, id DESC
CREATE INDEX IF NOT EXISTS "insureds_tenant_created_at_idx"
  ON "insureds" ("tenant_id", "created_at" DESC, "id" DESC);
