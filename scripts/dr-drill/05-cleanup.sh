#!/usr/bin/env bash
# 05-cleanup.sh — Tear down the restored RDS instance and any temporary
# buckets created during the drill. Idempotent.
#
# Inputs:
#   RESTORED_DB_IDENTIFIER  required (output of 02-rds-pitr-restore.sh)
#   AWS_REGION              default mx-central-1
#   DR_TEMP_BUCKETS         space-separated bucket names to delete (optional)
#
# Flags:
#   --dry-run | --no-dry-run
#   --identifier <id>       override RESTORED_DB_IDENTIFIER
#
# Safety:
#   - Refuses to touch any identifier containing "-prod-".
#   - Disables deletion-protection BEFORE delete-db-instance.
#   - skip_final_snapshot=true (this is a throw-away restore).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$HERE/_lib.sh"

assert_no_creds_in_argv "$@"
parse_common_flags "$@"

i=0
while [[ $i -lt ${#REMAINING_ARGS[@]} ]]; do
  arg="${REMAINING_ARGS[$i]}"
  case "$arg" in
    --identifier) RESTORED_DB_IDENTIFIER="${REMAINING_ARGS[$((i+1))]}"; i=$((i+2)) ;;
    *) i=$((i+1)) ;;
  esac
done

RESTORED_DB_IDENTIFIER="${RESTORED_DB_IDENTIFIER:-}"
AWS_REGION="${AWS_REGION:-mx-central-1}"
DR_TEMP_BUCKETS="${DR_TEMP_BUCKETS:-}"

if [[ -z "$RESTORED_DB_IDENTIFIER" ]]; then
  log ERROR "RESTORED_DB_IDENTIFIER must be set"
  exit 2
fi

assert_not_prod "$RESTORED_DB_IDENTIFIER"

LOG_DIR="$(log_dir)"
LOG_FILE="$LOG_DIR/05-cleanup.log"
exec > >(tee -a "$LOG_FILE") 2>&1

log INFO "DR drill | step 05 | cleanup"
log INFO "  identifier   = $RESTORED_DB_IDENTIFIER"
log INFO "  region       = $AWS_REGION"
log INFO "  temp buckets = ${DR_TEMP_BUCKETS:-<none>}"
log INFO "  dry-run      = $DRY_RUN"

# 1. Disable deletion protection.
run_or_echo aws rds modify-db-instance \
  --region "$AWS_REGION" \
  --db-instance-identifier "$RESTORED_DB_IDENTIFIER" \
  --no-deletion-protection \
  --apply-immediately

# 2. Wait until the modify is applied (state available, not modifying).
if [[ "$DRY_RUN" != "1" ]]; then
  aws rds wait db-instance-available \
    --region "$AWS_REGION" \
    --db-instance-identifier "$RESTORED_DB_IDENTIFIER"
fi

# 3. Delete with skip_final_snapshot=true (this is a throw-away restore).
run_or_echo aws rds delete-db-instance \
  --region "$AWS_REGION" \
  --db-instance-identifier "$RESTORED_DB_IDENTIFIER" \
  --skip-final-snapshot \
  --delete-automated-backups

if [[ "$DRY_RUN" != "1" ]]; then
  log INFO "Waiting for $RESTORED_DB_IDENTIFIER to be fully deleted..."
  aws rds wait db-instance-deleted \
    --region "$AWS_REGION" \
    --db-instance-identifier "$RESTORED_DB_IDENTIFIER"
fi

# 4. Optional: empty + delete temporary buckets.
if [[ -n "$DR_TEMP_BUCKETS" ]]; then
  for bucket in $DR_TEMP_BUCKETS; do
    assert_not_prod "$bucket"
    log INFO "emptying + deleting temp bucket $bucket"
    run_or_echo aws s3 rm "s3://$bucket" --recursive
    run_or_echo aws s3api delete-bucket --bucket "$bucket" --region "$AWS_REGION"
  done
fi

log OK "cleanup complete"
