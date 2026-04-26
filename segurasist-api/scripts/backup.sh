#!/usr/bin/env bash
# segurasist-api/scripts/backup.sh
#
# Backup operativo INTERIM (Sprint 1–4) del Postgres local hacia LocalStack S3.
#
# Genera un dump custom-format de la base, calcula sha256, y sube ambos
# (.dump + .sha256) al bucket de audit (versioning ON, Object Lock OFF — ver
# docs/INTERIM_RISKS.md). El sha256 funciona como interim audit-trail firmado
# hasta que Sprint 5 active S3 Object Lock COMPLIANCE + RDS automated backups
# (ADR-012).
#
# Uso:
#   ./scripts/backup.sh
#
# Variables override (opcional):
#   PGURL          postgresql://user:pass@host:port/db
#                  (default: postgresql://segurasist:segurasist@localhost:5432/segurasist)
#   BUCKET         bucket S3 destino (default: segurasist-dev-audit)
#   AWS_ENDPOINT   endpoint LocalStack (default: http://localhost:4566)
#   RETENTION_DAYS retención (default: 14) — NO implementado todavía;
#                  Sprint 5 lo cierra con S3 Lifecycle real.
#
# Smoke test del backup:
#   ./scripts/backup.sh
#   # Output esperado: "[ok] backup OK — s3://segurasist-dev-audit/backups/.../segurasist-...dump"
#   # Verifica:
#   AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
#     aws --endpoint-url=http://localhost:4566 s3 ls \
#       s3://segurasist-dev-audit/backups/ --recursive

set -euo pipefail

# ---------- helpers ----------

err() { printf '[err] %s\n' "$*" >&2; }
log() { printf '[..] %s\n' "$*" >&2; }
ok()  { printf '[ok] %s\n' "$*" >&2; }

# ---------- config ----------

PGURL="${PGURL:-postgresql://segurasist:segurasist@localhost:5432/segurasist}"
BUCKET="${BUCKET:-segurasist-dev-audit}"
AWS_ENDPOINT="${AWS_ENDPOINT:-http://localhost:4566}"
# RETENTION_DAYS="${RETENTION_DAYS:-14}"  # reservado — Sprint 5 con S3 Lifecycle

# Credenciales LocalStack (NO secretos reales — sólo mockeadas en LocalStack)
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DATE_PREFIX="$(date -u +%Y/%m/%d)"
TMP_DIR="$(mktemp -d -t segurasist-backup-XXXXXX)"
DUMP_NAME="segurasist-${TIMESTAMP}.dump"
DUMP_PATH="${TMP_DIR}/${DUMP_NAME}"
SHA_PATH="${DUMP_PATH}.sha256"
S3_KEY="backups/${DATE_PREFIX}/${DUMP_NAME}"
S3_URI="s3://${BUCKET}/${S3_KEY}"
S3_SHA_URI="${S3_URI}.sha256"

# Cleanup automático del temp dir, pase lo que pase.
cleanup() {
  rm -rf "${TMP_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

# ---------- precheck: docker postgres healthy ----------

log "verificando container postgres healthy"
PG_CONTAINER="$(docker ps --filter "name=segurasist-postgres" --format '{{.Names}}' | head -1)"
if [ -z "${PG_CONTAINER}" ]; then
  err "container 'segurasist-postgres' no está corriendo. Ejecuta 'docker compose up -d' en segurasist-api/."
  exit 1
fi
PG_HEALTH="$(docker inspect --format '{{.State.Health.Status}}' "${PG_CONTAINER}" 2>/dev/null || echo "unknown")"
if [ "${PG_HEALTH}" != "healthy" ]; then
  err "container ${PG_CONTAINER} health = '${PG_HEALTH}' (esperado: healthy). Revisa 'docker compose ps'."
  exit 1
fi
ok "postgres healthy (${PG_CONTAINER})"

# ---------- precheck: aws cli ----------

if ! command -v aws >/dev/null 2>&1; then
  err "aws cli no encontrado en PATH"
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  err "pg_dump no encontrado en PATH"
  exit 1
fi
if ! command -v sha256sum >/dev/null 2>&1; then
  err "sha256sum no encontrado en PATH"
  exit 1
fi

# ---------- precheck: bucket existe ----------

log "verificando bucket s3://${BUCKET}"
if ! aws --endpoint-url="${AWS_ENDPOINT}" s3api head-bucket --bucket "${BUCKET}" >/dev/null 2>&1; then
  err "bucket s3://${BUCKET} no existe o no es accesible vía ${AWS_ENDPOINT}"
  err "ejecuta ./scripts/localstack-bootstrap.sh"
  exit 1
fi

# ---------- pg_dump ----------

log "pg_dump → ${DUMP_PATH}"
# format=custom permite pg_restore con --clean/--if-exists; compress=9 minimiza
# tamaño on-the-wire; --no-owner/--no-privileges para que el restore funcione
# en cualquier rol (interim setup multi-dev).
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --compress=9 \
  --dbname="${PGURL}" \
  --file="${DUMP_PATH}"

if [ ! -s "${DUMP_PATH}" ]; then
  err "pg_dump produjo un archivo vacío"
  exit 1
fi

DUMP_SIZE_BYTES="$(stat -f%z "${DUMP_PATH}" 2>/dev/null || stat -c%s "${DUMP_PATH}")"
DUMP_SIZE_HUMAN="$(du -h "${DUMP_PATH}" | awk '{print $1}')"

# ---------- sha256 ----------

log "calculando sha256"
( cd "${TMP_DIR}" && sha256sum "${DUMP_NAME}" > "${DUMP_NAME}.sha256" )
SHA256="$(awk '{print $1}' "${SHA_PATH}")"

# ---------- upload a S3 ----------

log "subiendo dump → ${S3_URI}"
aws --endpoint-url="${AWS_ENDPOINT}" s3 cp \
  "${DUMP_PATH}" "${S3_URI}" \
  --no-progress

log "subiendo sha256 → ${S3_SHA_URI}"
aws --endpoint-url="${AWS_ENDPOINT}" s3 cp \
  "${SHA_PATH}" "${S3_SHA_URI}" \
  --no-progress

# ---------- metadata ----------

cat <<EOF >&2

----------------------------------------------------------------------
backup metadata
----------------------------------------------------------------------
timestamp:    ${TIMESTAMP}
dump file:    ${DUMP_NAME}
dump size:    ${DUMP_SIZE_HUMAN} (${DUMP_SIZE_BYTES} bytes)
sha256:       ${SHA256}
s3 dump:      ${S3_URI}
s3 sha256:    ${S3_SHA_URI}
restore:      ./scripts/restore.sh ${S3_URI}
----------------------------------------------------------------------
EOF

ok "backup OK — ${S3_URI}"
