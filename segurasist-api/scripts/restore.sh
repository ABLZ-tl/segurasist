#!/usr/bin/env bash
# segurasist-api/scripts/restore.sh
#
# Restore de un dump generado por scripts/backup.sh.
#
# Uso:
#   ./scripts/restore.sh <s3-uri-o-archivo-local>
#   ./scripts/restore.sh --help
#
# Ejemplos:
#   ./scripts/restore.sh s3://segurasist-dev-audit/backups/2026/04/25/segurasist-20260425T235959Z.dump
#   ./scripts/restore.sh /tmp/segurasist-20260425T235959Z.dump
#
# Variables override (opcional):
#   PGURL          postgresql://user:pass@host:port/db
#                  (default: postgresql://segurasist:segurasist@localhost:5432/segurasist)
#   AWS_ENDPOINT   endpoint LocalStack (default: http://localhost:4566)
#
# DANGER: pide confirmación interactiva antes de WIPE + RESTORE — usa
# pg_restore --clean --if-exists, lo que dropea todos los objetos antes de
# recrearlos. NO ejecutar contra producción (en producción será RDS con PITR
# manejado fuera de este script).

set -euo pipefail

err() { printf '[err] %s\n' "$*" >&2; }
log() { printf '[..] %s\n' "$*" >&2; }
ok()  { printf '[ok] %s\n' "$*" >&2; }

usage() {
  cat <<EOF
Usage: $0 <s3-uri-or-local-file>

Restaura un dump de Postgres generado por scripts/backup.sh.

Argumentos:
  <s3-uri-or-local-file>  S3 URI (s3://bucket/key) o ruta local al .dump

Variables de entorno (opcional):
  PGURL          (default: postgresql://segurasist:segurasist@localhost:5432/segurasist)
  AWS_ENDPOINT   (default: http://localhost:4566)

Comportamiento:
  1. Si es S3 URI → descarga dump + .sha256 a /tmp.
  2. Verifica sha256 contra el .sha256 paralelo.
  3. Pide confirmación interactiva (escribe 'yes').
  4. Ejecuta pg_restore --clean --if-exists --no-owner --no-privileges.

DANGER: el restore wipea la BD destino antes de recrearla.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ "$#" -ne 1 ]; then
  err "se requiere exactamente 1 argumento"
  usage >&2
  exit 1
fi

INPUT="$1"

PGURL="${PGURL:-postgresql://segurasist:segurasist@localhost:5432/segurasist}"
AWS_ENDPOINT="${AWS_ENDPOINT:-http://localhost:4566}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

TMP_DIR="$(mktemp -d -t segurasist-restore-XXXXXX)"
cleanup() {
  rm -rf "${TMP_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

# ---------- resolver fuente ----------

if [[ "${INPUT}" == s3://* ]]; then
  log "descargando dump desde ${INPUT}"
  DUMP_NAME="$(basename "${INPUT}")"
  DUMP_PATH="${TMP_DIR}/${DUMP_NAME}"
  SHA_URI="${INPUT}.sha256"
  SHA_PATH="${DUMP_PATH}.sha256"

  aws --endpoint-url="${AWS_ENDPOINT}" s3 cp "${INPUT}" "${DUMP_PATH}" --no-progress
  log "descargando sha256 desde ${SHA_URI}"
  aws --endpoint-url="${AWS_ENDPOINT}" s3 cp "${SHA_URI}" "${SHA_PATH}" --no-progress
else
  if [ ! -f "${INPUT}" ]; then
    err "archivo local '${INPUT}' no existe"
    exit 1
  fi
  DUMP_PATH="$(cd "$(dirname "${INPUT}")" && pwd)/$(basename "${INPUT}")"
  DUMP_NAME="$(basename "${DUMP_PATH}")"
  SHA_PATH="${DUMP_PATH}.sha256"
  if [ ! -f "${SHA_PATH}" ]; then
    err "sha256 paralelo no encontrado: ${SHA_PATH}"
    err "no se puede verificar integridad — abortando"
    exit 1
  fi
fi

# ---------- verificar sha256 ----------

log "verificando sha256"
EXPECTED_SHA="$(awk '{print $1}' "${SHA_PATH}")"
ACTUAL_SHA="$(sha256sum "${DUMP_PATH}" | awk '{print $1}')"
if [ "${EXPECTED_SHA}" != "${ACTUAL_SHA}" ]; then
  err "sha256 mismatch"
  err "  expected: ${EXPECTED_SHA}"
  err "  actual:   ${ACTUAL_SHA}"
  exit 1
fi
ok "sha256 OK (${ACTUAL_SHA})"

# ---------- confirmación interactiva ----------

cat <<EOF >&2

----------------------------------------------------------------------
DANGER ZONE
----------------------------------------------------------------------
Vas a WIPEAR + RESTORE la BD destino:
  pgurl:    ${PGURL}
  source:   ${INPUT}
  dump:     ${DUMP_NAME}
  sha256:   ${ACTUAL_SHA}

pg_restore --clean --if-exists dropea TODOS los objetos antes de recrearlos.
Si la BD apunta a producción, ABORTA AHORA con Ctrl+C.
----------------------------------------------------------------------
EOF

read -r -p "DANGER: this will WIPE the local DB. Type 'yes' to continue: " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
  err "abortado (confirmación = '${CONFIRM}')"
  exit 1
fi

# ---------- pg_restore ----------

log "pg_restore → ${PGURL}"
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname="${PGURL}" \
  "${DUMP_PATH}"

ok "restore OK — ${DUMP_NAME}"
