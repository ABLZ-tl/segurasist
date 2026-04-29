#!/usr/bin/env bash
# 02-rds-pitr-restore.sh — Restore the staging RDS instance to a point in
# time. Creates a parallel instance segurasist-staging-restored-{ts} (does
# NOT touch the source). Prints a connection string and total elapsed time
# (used as RTO sample).
#
# Inputs (env or CLI):
#   DR_SOURCE_DB_IDENTIFIER  default segurasist-staging-rds-main
#   AWS_REGION               default mx-central-1
#   TARGET_TIMESTAMP         ISO-8601 UTC; default 1h ago
#   DR_RESTORED_SUBNET_GROUP default segurasist-staging-rds-main-subnets
#   DR_RESTORED_SG_IDS       comma-separated SG ids; default empty
#   DR_RESTORED_INSTANCE_CLASS default db.t4g.small
#   DR_RESTORED_KMS_KEY_ID   default empty (uses source key)
#
# Flags:
#   --dry-run | --no-dry-run
#   --target <iso8601>   override TARGET_TIMESTAMP
#   --suffix <slug>      override the timestamp suffix on the new identifier
#
# Output:
#   - prints `RESTORED_DB_IDENTIFIER=...`
#   - prints `RESTORED_DB_ENDPOINT=...`
#   - prints `RESTORED_DB_CONNECTION_STRING=...` (no password — uses Secrets Manager)
#   - prints `RTO_SECONDS=...`
#   - exits 0 on success

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$HERE/_lib.sh"

assert_no_creds_in_argv "$@"
parse_common_flags "$@"

# Pull non-common flags from REMAINING_ARGS.
TARGET_TIMESTAMP_OVERRIDE=""
SUFFIX_OVERRIDE=""
i=0
while [[ $i -lt ${#REMAINING_ARGS[@]} ]]; do
  arg="${REMAINING_ARGS[$i]}"
  case "$arg" in
    --target)
      TARGET_TIMESTAMP_OVERRIDE="${REMAINING_ARGS[$((i+1))]}"
      i=$((i+2))
      ;;
    --suffix)
      SUFFIX_OVERRIDE="${REMAINING_ARGS[$((i+1))]}"
      i=$((i+2))
      ;;
    *)
      i=$((i+1))
      ;;
  esac
done

DR_SOURCE_DB_IDENTIFIER="${DR_SOURCE_DB_IDENTIFIER:-segurasist-staging-rds-main}"
AWS_REGION="${AWS_REGION:-mx-central-1}"
DR_RESTORED_SUBNET_GROUP="${DR_RESTORED_SUBNET_GROUP:-${DR_SOURCE_DB_IDENTIFIER}-subnets}"
DR_RESTORED_INSTANCE_CLASS="${DR_RESTORED_INSTANCE_CLASS:-db.t4g.small}"
DR_RESTORED_SG_IDS="${DR_RESTORED_SG_IDS:-}"
DR_RESTORED_KMS_KEY_ID="${DR_RESTORED_KMS_KEY_ID:-}"

# Resolve TARGET_TIMESTAMP. Default = 1h ago.
if [[ -n "$TARGET_TIMESTAMP_OVERRIDE" ]]; then
  TARGET_TIMESTAMP="$TARGET_TIMESTAMP_OVERRIDE"
elif [[ -n "${TARGET_TIMESTAMP:-}" ]]; then
  : # already set in env
else
  TARGET_TIMESTAMP="$(date -u -v-1H +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d '1 hour ago' +"%Y-%m-%dT%H:%M:%SZ")"
fi

SUFFIX="${SUFFIX_OVERRIDE:-$(ts_iso)}"
RESTORED_DB_IDENTIFIER="segurasist-staging-restored-${SUFFIX}"

assert_not_prod "$DR_SOURCE_DB_IDENTIFIER"
assert_not_prod "$RESTORED_DB_IDENTIFIER"

LOG_DIR="$(log_dir)"
LOG_FILE="$LOG_DIR/02-rds-pitr-restore.log"
exec > >(tee -a "$LOG_FILE") 2>&1

log INFO "DR drill | step 02 | RDS PITR restore"
log INFO "  source            = $DR_SOURCE_DB_IDENTIFIER"
log INFO "  target timestamp  = $TARGET_TIMESTAMP"
log INFO "  restored as       = $RESTORED_DB_IDENTIFIER"
log INFO "  instance class    = $DR_RESTORED_INSTANCE_CLASS"
log INFO "  subnet group      = $DR_RESTORED_SUBNET_GROUP"
log INFO "  region            = $AWS_REGION"
log INFO "  dry-run           = $DRY_RUN"

start_epoch="$(epoch_now)"

# Build the restore command.
#
# `--tags Purpose=dr-drill-restore` es contractual con el módulo IAM
# `dr-drill-iam`: las acciones destructivas (`rds:DeleteDBInstance`,
# `rds:ModifyDBInstance`) están condicionadas a este tag. Si se omite,
# el cleanup en step 05 falla con AccessDenied (defense-in-depth).
restore_cmd=(
  aws rds restore-db-instance-to-point-in-time
  --region "$AWS_REGION"
  --source-db-instance-identifier "$DR_SOURCE_DB_IDENTIFIER"
  --target-db-instance-identifier "$RESTORED_DB_IDENTIFIER"
  --restore-time "$TARGET_TIMESTAMP"
  --db-subnet-group-name "$DR_RESTORED_SUBNET_GROUP"
  --db-instance-class "$DR_RESTORED_INSTANCE_CLASS"
  --no-multi-az
  --no-publicly-accessible
  --copy-tags-to-snapshot
  --deletion-protection
  --tags "Key=Purpose,Value=dr-drill-restore" "Key=Component,Value=dr-drill" "Key=Owner,Value=G-1"
)

if [[ -n "$DR_RESTORED_SG_IDS" ]]; then
  IFS=',' read -r -a sg_array <<< "$DR_RESTORED_SG_IDS"
  restore_cmd+=( --vpc-security-group-ids "${sg_array[@]}" )
fi
if [[ -n "$DR_RESTORED_KMS_KEY_ID" ]]; then
  restore_cmd+=( --kms-key-id "$DR_RESTORED_KMS_KEY_ID" )
fi

run_or_echo "${restore_cmd[@]}" || {
  log ERROR "restore-db-instance-to-point-in-time failed"
  exit 10
}

# Wait until the new instance is available (idempotent — `aws wait` polls
# every 30s up to ~30min).
log INFO "Waiting for $RESTORED_DB_IDENTIFIER to become available..."
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[DRY-RUN] aws rds wait db-instance-available --db-instance-identifier $RESTORED_DB_IDENTIFIER --region $AWS_REGION"
  endpoint="<dry-run-endpoint>:5432"
else
  aws rds wait db-instance-available \
    --db-instance-identifier "$RESTORED_DB_IDENTIFIER" \
    --region "$AWS_REGION"
  endpoint="$(aws rds describe-db-instances \
    --region "$AWS_REGION" \
    --db-instance-identifier "$RESTORED_DB_IDENTIFIER" \
    --query 'DBInstances[0].Endpoint.[Address,Port]' \
    --output text | awk '{ printf "%s:%s", $1, $2 }')"
fi

end_epoch="$(epoch_now)"
elapsed=$(( end_epoch - start_epoch ))

# Surface canonical key=value pairs the orchestrator reads.
echo "RESTORED_DB_IDENTIFIER=${RESTORED_DB_IDENTIFIER}"
echo "RESTORED_DB_ENDPOINT=${endpoint}"
# Connection string deliberately omits user/password — caller resolves the
# Secrets Manager ARN matching the source instance.
echo "RESTORED_DB_CONNECTION_STRING=postgres://<secrets-manager>@${endpoint}/segurasist"
echo "RTO_SECONDS=${elapsed}"
echo "TARGET_TIMESTAMP=${TARGET_TIMESTAMP}"

log OK "step 02 complete — RTO sample = ${elapsed}s (target ≤ 14400s aka 4h)"
