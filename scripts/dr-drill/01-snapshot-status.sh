#!/usr/bin/env bash
# 01-snapshot-status.sh — Inventory automated RDS snapshots (last 7d) and
# S3 versioning/lifecycle status of the audit/uploads/certificates/exports
# buckets in the staging account.
#
# Inputs (env or CLI):
#   DR_SOURCE_DB_IDENTIFIER  RDS source identifier  (default: segurasist-staging-rds-main)
#   AWS_REGION               AWS region              (default: mx-central-1)
#   DR_BUCKETS               space-separated bucket names; defaults to the
#                            staging quartet (uploads, certificates, exports, audit)
#
# Flags:
#   --dry-run | --no-dry-run
#
# Output:
#   Two markdown tables on stdout (RDS + S3) and a copy archived under
#   .dr-drill-logs/<ts>/01-snapshot-status.log

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$HERE/_lib.sh"

assert_no_creds_in_argv "$@"
parse_common_flags "$@"

DR_SOURCE_DB_IDENTIFIER="${DR_SOURCE_DB_IDENTIFIER:-segurasist-staging-rds-main}"
AWS_REGION="${AWS_REGION:-mx-central-1}"
ACCOUNT_ID="${ACCOUNT_ID:-}"
DR_BUCKETS_DEFAULT=(
  "segurasist-staging-uploads"
  "segurasist-staging-certificates"
  "segurasist-staging-exports"
  "segurasist-staging-audit"
)

if [[ -n "${DR_BUCKETS:-}" ]]; then
  # shellcheck disable=SC2206
  buckets=( ${DR_BUCKETS} )
else
  buckets=( "${DR_BUCKETS_DEFAULT[@]}" )
fi

assert_not_prod "$DR_SOURCE_DB_IDENTIFIER"

LOG_DIR="$(log_dir)"
LOG_FILE="$LOG_DIR/01-snapshot-status.log"
exec > >(tee -a "$LOG_FILE") 2>&1

log INFO "DR drill | step 01 | snapshot status"
log INFO "  source RDS  = $DR_SOURCE_DB_IDENTIFIER"
log INFO "  region      = $AWS_REGION"
log INFO "  buckets     = ${buckets[*]}"
log INFO "  dry-run     = $DRY_RUN"

since_iso="$(date -u -v-7d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d '7 days ago' +"%Y-%m-%dT%H:%M:%SZ")"
log INFO "Listing automated snapshots since $since_iso"

echo
echo "## RDS automated snapshots (last 7d)"
echo
echo "| SnapshotId | Type | Created | Size GiB | Status |"
echo "|---|---|---|---|---|"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "| [DRY-RUN] | automated | [DRY-RUN] | [DRY-RUN] | [DRY-RUN] |"
else
  aws rds describe-db-snapshots \
    --region "$AWS_REGION" \
    --db-instance-identifier "$DR_SOURCE_DB_IDENTIFIER" \
    --snapshot-type automated \
    --query "DBSnapshots[?SnapshotCreateTime>=\`$since_iso\`].[DBSnapshotIdentifier,SnapshotType,SnapshotCreateTime,AllocatedStorage,Status]" \
    --output text |
    awk 'NF { printf("| %s | %s | %s | %s | %s |\n", $1, $2, $3, $4, $5) }'
fi

echo
echo "## S3 versioning + lifecycle"
echo
echo "| Bucket | Versioning | MFADelete | Lifecycle rules | LastNoncurrentTransition |"
echo "|---|---|---|---|---|"

for bucket in "${buckets[@]}"; do
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "| $bucket | [DRY-RUN] | [DRY-RUN] | [DRY-RUN] | [DRY-RUN] |"
    continue
  fi

  versioning="$(aws s3api get-bucket-versioning --bucket "$bucket" --query 'Status' --output text 2>/dev/null || echo "ABSENT")"
  mfa="$(aws s3api get-bucket-versioning --bucket "$bucket" --query 'MFADelete' --output text 2>/dev/null || echo "n/a")"
  rules="$(aws s3api get-bucket-lifecycle-configuration --bucket "$bucket" --query 'length(Rules)' --output text 2>/dev/null || echo 0)"
  last_transition="$(aws s3api get-bucket-lifecycle-configuration --bucket "$bucket" \
    --query 'Rules[].NoncurrentVersionExpiration.NoncurrentDays' --output text 2>/dev/null || echo "n/a")"
  echo "| $bucket | ${versioning:-ABSENT} | ${mfa:-n/a} | ${rules:-0} | ${last_transition:-n/a}d |"
done

echo
log OK "step 01 complete — output archived at $LOG_FILE"
