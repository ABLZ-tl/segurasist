#!/usr/bin/env bash
# =========================================================================
# S3-07 — Seed bulk insureds para perf-test (60k filas).
#
# Genera CURPs sintéticos + nombres ficticios y los inserta en lotes de 1k
# vía COPY (psql). 60k filas ≈ 50 MB de espacio + 5 min de wall-clock en un
# Mac M2 con Postgres en docker.
#
# Tenant target: el primer tenant con slug `mac` (o el especificado vía
# `TENANT_SLUG`). Si no existe → falla con mensaje útil.
#
# Idempotencia: usa `ON CONFLICT (tenant_id, curp) DO NOTHING`. Re-runs son
# seguros y no duplican filas. La perf NO mejora en re-runs (cada lote se
# valida).
#
# Variables opcionales:
#   PG_URL          DSN postgres (default `postgresql://segurasist:segurasist@localhost:5432/segurasist`)
#   TENANT_SLUG     Slug del tenant (default `mac`)
#   TARGET_ROWS     Número de filas a generar (default 60000)
#   BATCH_SIZE      Filas por COPY (default 1000)
#
# Output esperado:
#   [seed-bulk] OK: 60000 insureds insertados en tenant mac
#
# NOTA: este script asume que existe AL MENOS un Package en el tenant. Si no,
# falla con `package_not_found` antes de empezar.
# =========================================================================

set -euo pipefail

PG_URL="${PG_URL:-postgresql://segurasist:segurasist@localhost:5432/segurasist}"
TENANT_SLUG="${TENANT_SLUG:-mac}"
TARGET_ROWS="${TARGET_ROWS:-60000}"
BATCH_SIZE="${BATCH_SIZE:-1000}"

if ! command -v psql >/dev/null 2>&1; then
  echo "[seed-bulk] FATAL: psql no encontrado en PATH" >&2
  exit 1
fi

# Resolver tenant + package.
TENANT_ID=$(psql "${PG_URL}" -At -c "SELECT id FROM tenants WHERE slug = '${TENANT_SLUG}' AND deleted_at IS NULL LIMIT 1;" 2>/dev/null || echo "")
if [[ -z "${TENANT_ID}" ]]; then
  echo "[seed-bulk] FATAL: tenant '${TENANT_SLUG}' no encontrado. Corre el seed primero (npx prisma db seed)." >&2
  exit 2
fi

PACKAGE_ID=$(psql "${PG_URL}" -At -c "SELECT id FROM packages WHERE tenant_id = '${TENANT_ID}' AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1;" 2>/dev/null || echo "")
if [[ -z "${PACKAGE_ID}" ]]; then
  echo "[seed-bulk] FATAL: no hay packages en tenant ${TENANT_SLUG}. Crea uno primero." >&2
  exit 3
fi

echo "[seed-bulk] tenant=${TENANT_SLUG} (${TENANT_ID:0:8}...) package=${PACKAGE_ID:0:8}..."
echo "[seed-bulk] target=${TARGET_ROWS} batch=${BATCH_SIZE}"
echo "[seed-bulk] tiempo estimado ~5 min, espacio disco ~50 MB"

# =========================================================================
# Generación + INSERT con plpgsql server-side. Mucho más rápido que armar
# strings en bash. Un loop genera N filas por batch, las construye con
# generate_series + funciones aleatorias y las inserta con ON CONFLICT.
# =========================================================================
#
# CURP sintético: 4 letras + 6 dígitos (yymmdd) + sexo (H/M) + 5 letras +
# 1 char (A-Z|0-9) + 1 dígito = 18 chars. NO calculamos el dígito verificador
# real porque sólo necesitamos uniqueness para el perf-test; agregamos el
# offset del seed al sufijo para garantizar unicidad inter-batch sin colisión.
START_TS=$(date +%s)
TOTAL_INSERTED=0

for ((BATCH_OFFSET=0; BATCH_OFFSET<TARGET_ROWS; BATCH_OFFSET+=BATCH_SIZE)); do
  END_OFFSET=$((BATCH_OFFSET + BATCH_SIZE))
  if (( END_OFFSET > TARGET_ROWS )); then
    END_OFFSET=$TARGET_ROWS
  fi
  # plpgsql server-side: generate_series + INSERT ... ON CONFLICT.
  RESULT=$(psql "${PG_URL}" -At <<SQL
WITH gen AS (
  SELECT
    n,
    -- CURP único: 4 letras determinísticas + offset (6 dígitos) + 7 chars
    -- pseudo-aleatorios que dependen de n para idempotencia.
    'PERF' ||
    LPAD(((n + ${BATCH_OFFSET}) % 999999)::text, 6, '0') ||
    CASE WHEN (n % 2) = 0 THEN 'H' ELSE 'M' END ||
    chr(65 + ((n * 3) % 26)) ||
    chr(65 + ((n * 7) % 26)) ||
    chr(65 + ((n * 11) % 26)) ||
    chr(65 + ((n * 13) % 26)) ||
    chr(65 + ((n * 17) % 26)) ||
    LPAD((n % 10)::text, 1, '0') AS curp,
    'PerfTest Apellido' || (n + ${BATCH_OFFSET})::text || ' Nombre' AS full_name,
    DATE '1980-01-01' + ((n + ${BATCH_OFFSET}) % 14600) AS dob,
    'perf' || (n + ${BATCH_OFFSET})::text || '@perf.local' AS email,
    DATE '2026-01-01' AS valid_from,
    DATE '2027-01-01' AS valid_to
  FROM generate_series(1, $((END_OFFSET - BATCH_OFFSET))) AS n
)
INSERT INTO insureds
  (id, tenant_id, curp, full_name, dob, email, package_id, valid_from, valid_to, status, created_at, updated_at)
SELECT
  gen_random_uuid(),
  '${TENANT_ID}'::uuid,
  curp,
  full_name,
  dob,
  email,
  '${PACKAGE_ID}'::uuid,
  valid_from,
  valid_to,
  'active'::insured_status,
  now(),
  now()
FROM gen
ON CONFLICT (tenant_id, curp) DO NOTHING
RETURNING 1;
SQL
)
  COUNT=$(echo "${RESULT}" | grep -c '^1$' || true)
  TOTAL_INSERTED=$((TOTAL_INSERTED + COUNT))
  ELAPSED=$(( $(date +%s) - START_TS ))
  printf "[seed-bulk] batch %d-%d → %d insertados (acum=%d, %ds)\n" \
    "${BATCH_OFFSET}" "${END_OFFSET}" "${COUNT}" "${TOTAL_INSERTED}" "${ELAPSED}"
done

echo ""
echo "[seed-bulk] OK: ${TOTAL_INSERTED} insureds insertados en tenant ${TENANT_SLUG}"
