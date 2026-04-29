#!/usr/bin/env bash
# 03-s3-versioning-restore.sh — Restore a deleted/overwritten S3 object by
# promoting a previous version back to HEAD. Supports a single object or a
# batch via --prefix.
#
# Usage:
#   ./03-s3-versioning-restore.sh --bucket B --key K --version V
#   ./03-s3-versioning-restore.sh --bucket B --prefix path/ --before 2026-04-29T10:00:00Z
#
# Mechanics:
#   - Single mode: copies the chosen version on top of itself, which makes it
#     the new latest. (CopyObject with x-amz-copy-source pointing at the
#     versionId — AWS recommended pattern.)
#   - Batch mode: lists object versions under the prefix and picks the
#     newest version with LastModified <= --before, then promotes each.
#
# Flags:
#   --bucket <name>        required
#   --key <key>            single-object mode
#   --version <id>         single-object mode (specific version to promote)
#   --prefix <path/>       batch mode
#   --before <iso8601>     batch mode (inclusive cutoff for "good" version)
#   --dry-run | --no-dry-run
#
# Exit codes:
#   0 OK; 2 bad usage; 11 AWS failure.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$HERE/_lib.sh"

assert_no_creds_in_argv "$@"
parse_common_flags "$@"

BUCKET=""
KEY=""
VERSION=""
PREFIX=""
BEFORE=""

i=0
while [[ $i -lt ${#REMAINING_ARGS[@]} ]]; do
  arg="${REMAINING_ARGS[$i]}"
  case "$arg" in
    --bucket)  BUCKET="${REMAINING_ARGS[$((i+1))]}";  i=$((i+2)) ;;
    --key)     KEY="${REMAINING_ARGS[$((i+1))]}";     i=$((i+2)) ;;
    --version) VERSION="${REMAINING_ARGS[$((i+1))]}"; i=$((i+2)) ;;
    --prefix)  PREFIX="${REMAINING_ARGS[$((i+1))]}";  i=$((i+2)) ;;
    --before)  BEFORE="${REMAINING_ARGS[$((i+1))]}";  i=$((i+2)) ;;
    *) i=$((i+1)) ;;
  esac
done

if [[ -z "$BUCKET" ]]; then
  log ERROR "--bucket is required"
  exit 2
fi
if [[ -z "$KEY" && -z "$PREFIX" ]]; then
  log ERROR "either --key (single) or --prefix (batch) is required"
  exit 2
fi

assert_not_prod "$BUCKET"

LOG_DIR="$(log_dir)"
LOG_FILE="$LOG_DIR/03-s3-versioning-restore.log"
exec > >(tee -a "$LOG_FILE") 2>&1

log INFO "DR drill | step 03 | S3 versioning restore"
log INFO "  bucket   = $BUCKET"
log INFO "  key      = ${KEY:-<batch>}"
log INFO "  version  = ${VERSION:-<auto>}"
log INFO "  prefix   = ${PREFIX:-<n/a>}"
log INFO "  before   = ${BEFORE:-<n/a>}"
log INFO "  dry-run  = $DRY_RUN"

promote_one() {
  local key="$1" version="$2"
  log INFO "promoting s3://$BUCKET/$key versionId=$version"
  run_or_echo aws s3api copy-object \
    --bucket "$BUCKET" \
    --key "$key" \
    --copy-source "${BUCKET}/${key}?versionId=${version}" \
    --metadata-directive COPY \
    || return 11
}

if [[ -n "$KEY" ]]; then
  if [[ -z "$VERSION" ]]; then
    # Default to the second-most-recent version (i.e. "the one before the
    # delete marker / overwrite"). Useful for accidental delete recovery.
    if [[ "$DRY_RUN" == "1" ]]; then
      VERSION="<dry-run-version-id>"
    else
      VERSION="$(aws s3api list-object-versions \
        --bucket "$BUCKET" \
        --prefix "$KEY" \
        --query 'Versions[?Key==`'"$KEY"'`] | [1].VersionId' \
        --output text)"
    fi
  fi
  promote_one "$KEY" "$VERSION" || exit 11
  log OK "single-object restore complete"
  exit 0
fi

# Batch mode.
if [[ -z "$BEFORE" ]]; then
  log ERROR "--before <iso8601> is required in batch mode"
  exit 2
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[DRY-RUN] would list versions under s3://$BUCKET/$PREFIX with LastModified <= $BEFORE and promote each."
  exit 0
fi

# JSON pipeline: pick newest version per key with LastModified<=BEFORE.
aws s3api list-object-versions \
  --bucket "$BUCKET" \
  --prefix "$PREFIX" \
  --output json |
  jq -r --arg before "$BEFORE" '
    .Versions
    | map(select(.LastModified <= $before))
    | group_by(.Key)
    | map(max_by(.LastModified))
    | .[]
    | "\(.Key)\t\(.VersionId)"
  ' |
  while IFS=$'\t' read -r k v; do
    promote_one "$k" "$v" || exit 11
  done

log OK "batch restore complete"
