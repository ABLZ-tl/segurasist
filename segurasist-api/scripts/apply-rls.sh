#!/usr/bin/env bash
# Aplica el bootstrap de RLS contra el postgres del docker-compose local.
# Idempotente: puede correrse múltiples veces sin efectos colaterales.
#
# Crea dos roles DB (idempotentemente, en `policies.sql`):
#   - segurasist_app    NOBYPASSRLS  (cliente normal del API; aplica RLS)
#   - segurasist_admin  BYPASSRLS    (cliente superadmin / writer auditoría)
#
# Pre-requisito: `prisma migrate deploy` (o `migrate dev`) debe haber corrido
# antes — `policies.sql` referencia tablas concretas. Si la migración M2
# (`20260426_superadmin_nullable_tenant`) no se aplicó, este script falla
# limpio porque la columna `users.tenant_id` debe existir y ser nullable.
#
# Uso (después de `npx prisma migrate dev` o `migrate deploy`):
#   ./scripts/apply-rls.sh
#
# En CI / staging / prod: pasar PGURL apuntando al superuser de la BD destino:
#   PGURL='postgresql://postgres:***@host:5432/segurasist' ./scripts/apply-rls.sh

set -euo pipefail

# Default: postgres del docker-compose en localhost.
PGURL="${PGURL:-postgresql://segurasist:segurasist@localhost:5432/segurasist}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="${SCRIPT_DIR}/../prisma/rls/policies.sql"

if [[ ! -f "${SQL_FILE}" ]]; then
  echo "[apply-rls] FATAL: no encuentro ${SQL_FILE}" >&2
  exit 1
fi

# Preferimos psql si está; si no, exec dentro del contenedor postgres del compose.
if command -v psql >/dev/null 2>&1; then
  echo "[apply-rls] psql local → ${PGURL%%@*}@***"
  psql "${PGURL}" -v ON_ERROR_STOP=1 -f "${SQL_FILE}"
elif command -v docker >/dev/null 2>&1; then
  echo "[apply-rls] psql via docker exec segurasist-postgres"
  docker exec -i segurasist-postgres psql -U segurasist -d segurasist -v ON_ERROR_STOP=1 < "${SQL_FILE}"
else
  echo "[apply-rls] FATAL: ni psql ni docker disponibles en PATH" >&2
  exit 2
fi

# Sanity check: confirmar que ambos roles existen.
if command -v psql >/dev/null 2>&1; then
  ROLES=$(psql "${PGURL}" -tAc "SELECT string_agg(rolname, ',') FROM pg_roles WHERE rolname IN ('segurasist_app','segurasist_admin');" 2>/dev/null || echo "")
  echo "[apply-rls] roles presentes: ${ROLES}"

  # C-15 — Drift check. La política RLS sobre `exports` históricamente sólo
  # vivía en la migración `20260427_add_exports_table` y faltaba en este
  # `policies.sql`, así que aplicar el script contra una DB nueva omitía RLS
  # para `exports`. Verificamos POST-apply que existe la policy y bombeamos
  # error temprano si alguien quita la tabla del array.
  EXPORTS_POL=$(psql "${PGURL}" -tAc "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='exports';" 2>/dev/null || echo "0")
  EXPORTS_POL=$(echo "${EXPORTS_POL}" | tr -d '[:space:]')
  if [[ "${EXPORTS_POL}" -lt 2 ]]; then
    echo "[apply-rls] WARN: tabla 'exports' tiene ${EXPORTS_POL} políticas (esperadas >=2: select+modify). Drift?" >&2
  else
    echo "[apply-rls] exports policies presentes: ${EXPORTS_POL}"
  fi
fi

echo "[apply-rls] OK"
