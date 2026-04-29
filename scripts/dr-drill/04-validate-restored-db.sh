#!/usr/bin/env bash
# 04-validate-restored-db.sh — Smoke queries against the restored DB and
# diff against expected values.
#
# Inputs (env or CLI):
#   RESTORED_DB_ENDPOINT   host:port (output of 02-rds-pitr-restore.sh)
#   RESTORED_DB_NAME       default segurasist
#   RESTORED_DB_USERNAME   default segurasist_admin
#   RESTORED_DB_PASSWORD   sourced from Secrets Manager — caller exports it
#   DR_EXPECTED_TENANTS    integer expected count (env)
#   DR_EXPECTED_INSUREDS   integer expected count (env)
#   DR_EXPECTED_CLAIMS_24H integer expected count of claims created in last 24h
#
# Flags:
#   --dry-run | --no-dry-run
#   --expected-tenants N
#   --expected-insureds N
#   --expected-claims-24h N
#
# Output:
#   Markdown table with actual vs expected and PASS/FAIL per row.
#   Exit code 0 if all rows PASS, 12 otherwise.

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
    --expected-tenants)    DR_EXPECTED_TENANTS="${REMAINING_ARGS[$((i+1))]}";    i=$((i+2)) ;;
    --expected-insureds)   DR_EXPECTED_INSUREDS="${REMAINING_ARGS[$((i+1))]}";   i=$((i+2)) ;;
    --expected-claims-24h) DR_EXPECTED_CLAIMS_24H="${REMAINING_ARGS[$((i+1))]}"; i=$((i+2)) ;;
    *) i=$((i+1)) ;;
  esac
done

RESTORED_DB_ENDPOINT="${RESTORED_DB_ENDPOINT:-}"
RESTORED_DB_NAME="${RESTORED_DB_NAME:-segurasist}"
RESTORED_DB_USERNAME="${RESTORED_DB_USERNAME:-segurasist_admin}"
DR_EXPECTED_TENANTS="${DR_EXPECTED_TENANTS:-}"
DR_EXPECTED_INSUREDS="${DR_EXPECTED_INSUREDS:-}"
DR_EXPECTED_CLAIMS_24H="${DR_EXPECTED_CLAIMS_24H:-}"

if [[ -z "$RESTORED_DB_ENDPOINT" && "$DRY_RUN" != "1" ]]; then
  log ERROR "RESTORED_DB_ENDPOINT must be set (run 02-rds-pitr-restore.sh first)"
  exit 2
fi

LOG_DIR="$(log_dir)"
LOG_FILE="$LOG_DIR/04-validate-restored-db.log"
exec > >(tee -a "$LOG_FILE") 2>&1

log INFO "DR drill | step 04 | validate restored DB"
log INFO "  endpoint = ${RESTORED_DB_ENDPOINT:-<dry-run>}"
log INFO "  database = $RESTORED_DB_NAME"
log INFO "  user     = $RESTORED_DB_USERNAME"
log INFO "  dry-run  = $DRY_RUN"

run_psql() {
  local sql="$1"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY-RUN] psql ... -c \"$sql\"" >&2
    echo "0"
    return
  fi
  PGPASSWORD="${RESTORED_DB_PASSWORD:?RESTORED_DB_PASSWORD must be exported (Secrets Manager)}" \
    psql "host=${RESTORED_DB_ENDPOINT%:*} port=${RESTORED_DB_ENDPOINT#*:} dbname=$RESTORED_DB_NAME user=$RESTORED_DB_USERNAME sslmode=require" \
    -t -A -c "$sql"
}

# Smoke queries — RLS is bypassed via direct admin user (intentional for
# the drill validator; never use this user from the API).
tenants_actual="$(run_psql 'SELECT count(*) FROM "Tenant" WHERE "deletedAt" IS NULL;')"
insureds_actual="$(run_psql 'SELECT count(*) FROM "Insured" WHERE "deletedAt" IS NULL;')"
claims_actual="$(run_psql "SELECT count(*) FROM \"Claim\" WHERE \"createdAt\" > NOW() - interval '24 hours';")"
last_audit="$(run_psql 'SELECT MAX("createdAt") FROM "AuditLog";')"

# Compare.
status=0
echo
echo "## Validation results"
echo
echo "| Metric | Expected | Actual | Status |"
echo "|---|---|---|---|"

cmp() {
  local label="$1" expected="$2" actual="$3"
  if [[ -z "$expected" ]]; then
    echo "| $label | (not provided) | $actual | INFO |"
    return 0
  fi
  if [[ "$expected" == "$actual" ]]; then
    echo "| $label | $expected | $actual | PASS |"
  else
    echo "| $label | $expected | $actual | FAIL |"
    status=12
  fi
}

cmp "Tenants count"              "$DR_EXPECTED_TENANTS"     "$tenants_actual"
cmp "Insureds count"             "$DR_EXPECTED_INSUREDS"    "$insureds_actual"
cmp "Claims created last 24h"    "$DR_EXPECTED_CLAIMS_24H"  "$claims_actual"
echo "| Last AuditLog timestamp | (informational) | $last_audit | INFO |"

# Surface canonical key=value pairs for the orchestrator (RPO calc).
echo
echo "VALIDATION_LAST_AUDIT_TS=${last_audit}"
echo "VALIDATION_TENANTS=${tenants_actual}"
echo "VALIDATION_INSUREDS=${insureds_actual}"
echo "VALIDATION_CLAIMS_24H=${claims_actual}"
echo "VALIDATION_STATUS=$( [[ $status -eq 0 ]] && echo PASS || echo FAIL )"

if [[ $status -eq 0 ]]; then
  log OK "validation passed"
else
  log ERROR "validation FAILED — see table above"
fi
exit $status
