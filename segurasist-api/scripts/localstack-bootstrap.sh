#!/usr/bin/env bash
# Crea recursos AWS-emulados en LocalStack (idempotente).
# Uso (después de `docker compose up -d` y que `localstack` esté healthy):
#   ./scripts/localstack-bootstrap.sh
#
# Variables opcionales:
#   AWS_ENDPOINT (default http://localhost:4566)
#   AWS_REGION   (default mx-central-1 — debe coincidir con .env)
#   ENV_TAG      (default dev — se usa en los nombres de bucket)

set -euo pipefail

AWS_ENDPOINT="${AWS_ENDPOINT:-http://localhost:4566}"
# LocalStack 3.7 valida regiones contra una lista interna que aún no incluye
# `mx-central-1` (región nueva). Forzamos us-east-1 SOLO para el stack local;
# producción sigue siendo mx-central-1 vía Terraform en Sprint 5.
AWS_REGION="${LOCALSTACK_REGION:-us-east-1}"
ENV_TAG="${ENV_TAG:-dev}"

# Credenciales dummy obligatorias para que el AWS CLI no se queje
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="${AWS_REGION}"

if ! command -v aws >/dev/null 2>&1; then
  echo "[localstack-bootstrap] FATAL: aws CLI no está en PATH (instala awscli >=2.15)" >&2
  exit 1
fi

# Esperar a que LocalStack responda (hasta 30s)
echo "[localstack-bootstrap] esperando LocalStack en ${AWS_ENDPOINT} ..."
for i in $(seq 1 30); do
  if curl -fsS "${AWS_ENDPOINT}/_localstack/health" >/dev/null 2>&1; then
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "[localstack-bootstrap] FATAL: LocalStack no respondió en 30s. ¿corriste 'docker compose up -d'?" >&2
    exit 2
  fi
  sleep 1
done
echo "[localstack-bootstrap] LocalStack OK"

aws_local() {
  aws --endpoint-url="${AWS_ENDPOINT}" --region "${AWS_REGION}" "$@"
}

# =========================================================================
# 1) S3 buckets — uploads, certificates, audit, exports
# =========================================================================
BUCKETS=(
  "segurasist-${ENV_TAG}-uploads"
  "segurasist-${ENV_TAG}-certificates"
  "segurasist-${ENV_TAG}-audit"
  "segurasist-${ENV_TAG}-exports"
)

for b in "${BUCKETS[@]}"; do
  if aws_local s3api head-bucket --bucket "${b}" >/dev/null 2>&1; then
    echo "[s3] ${b} ya existe"
  else
    echo "[s3] creando ${b}"
    # us-east-1 NO acepta LocationConstraint; cualquier otra sí lo requiere.
    if [[ "${AWS_REGION}" == "us-east-1" ]]; then
      aws_local s3api create-bucket --bucket "${b}" >/dev/null
    else
      aws_local s3api create-bucket \
        --bucket "${b}" \
        --create-bucket-configuration "LocationConstraint=${AWS_REGION}" >/dev/null
    fi
  fi

  # Versionado en buckets de certificados y audit (en prod habrá Object Lock COMPLIANCE)
  case "${b}" in
    *certificates|*audit)
      aws_local s3api put-bucket-versioning \
        --bucket "${b}" \
        --versioning-configuration Status=Enabled >/dev/null
      echo "[s3] ${b} versioning=Enabled"
      ;;
  esac
done

# =========================================================================
# 2) SQS queues — layout, pdf, email, reports
# =========================================================================
QUEUES=(
  "layout-validation-queue"
  "pdf-queue"
  "email-queue"
  "reports-queue"
)

for q in "${QUEUES[@]}"; do
  if aws_local sqs get-queue-url --queue-name "${q}" >/dev/null 2>&1; then
    echo "[sqs] ${q} ya existe"
  else
    echo "[sqs] creando ${q}"
    aws_local sqs create-queue \
      --queue-name "${q}" \
      --attributes "VisibilityTimeout=300,MessageRetentionPeriod=1209600" >/dev/null
  fi
done

# =========================================================================
# 3) KMS key + alias
# =========================================================================
ALIAS="alias/segurasist-${ENV_TAG}"
EXISTING_ALIAS_KEY=$(aws_local kms list-aliases --query "Aliases[?AliasName=='${ALIAS}'].TargetKeyId | [0]" --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_ALIAS_KEY}" == "None" || -z "${EXISTING_ALIAS_KEY}" ]]; then
  echo "[kms] creando key + ${ALIAS}"
  KEY_ID=$(aws_local kms create-key \
    --description "SegurAsist ${ENV_TAG} (LocalStack)" \
    --query 'KeyMetadata.KeyId' --output text)
  aws_local kms create-alias --alias-name "${ALIAS}" --target-key-id "${KEY_ID}" >/dev/null
  echo "[kms] ${ALIAS} → ${KEY_ID}"
else
  echo "[kms] ${ALIAS} ya existe → ${EXISTING_ALIAS_KEY}"
fi

# =========================================================================
# 4) Resumen
# =========================================================================
echo ""
echo "[localstack-bootstrap] OK"
echo "  S3:  ${BUCKETS[*]}"
echo "  SQS: ${QUEUES[*]}"
echo "  KMS: ${ALIAS}"
