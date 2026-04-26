#!/usr/bin/env bash
# Aplica el bootstrap de RLS contra el postgres del docker-compose local.
# Idempotente: puede correrse múltiples veces sin efectos colaterales.
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

echo "[apply-rls] OK"
