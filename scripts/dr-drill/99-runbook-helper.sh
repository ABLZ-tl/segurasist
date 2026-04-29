#!/usr/bin/env bash
# 99-runbook-helper.sh — Orchestrator. Runs steps 01..04 in sequence,
# captures RTO/RPO timestamps, and prints a markdown summary that gets
# pasted into docs/dr-drills/YYYY-MM-DD-staging.md.
#
# Step 05 (cleanup) is INTENTIONALLY not invoked here — the runbook owner
# pastes results into the drill report first, then runs 05-cleanup.sh
# manually after the post-drill review.
#
# Flags:
#   --dry-run | --no-dry-run
#   --target <iso8601>    forwarded to step 02
#
# Output:
#   - markdown summary on stdout
#   - structured key=value lines parsed by the report template
#
# Exit code:
#   0 if all steps passed; non-zero (sum) if any step failed.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$HERE/_lib.sh"

assert_no_creds_in_argv "$@"
parse_common_flags "$@"

TARGET_OVERRIDE=""
i=0
while [[ $i -lt ${#REMAINING_ARGS[@]} ]]; do
  arg="${REMAINING_ARGS[$i]}"
  case "$arg" in
    --target) TARGET_OVERRIDE="${REMAINING_ARGS[$((i+1))]}"; i=$((i+2)) ;;
    *) i=$((i+1)) ;;
  esac
done

LOG_DIR="$(log_dir)"
SUMMARY_FILE="$LOG_DIR/99-runbook-summary.md"

DRILL_START_HUMAN="$(ts_human)"
DRILL_START_EPOCH="$(epoch_now)"

log INFO "DR drill | orchestrator START | $DRILL_START_HUMAN"
log INFO "  dry-run = $DRY_RUN"
log INFO "  target  = ${TARGET_OVERRIDE:-<default 1h ago>}"

forward_flags=()
if [[ "$DRY_RUN" == "1" ]]; then forward_flags+=(--dry-run); fi
if [[ -n "$TARGET_OVERRIDE" ]]; then forward_flags+=(--target "$TARGET_OVERRIDE"); fi

# ---- Step 01 ----------------------------------------------------------------
log INFO "→ step 01 (snapshot status)"
step01_out="$("$HERE/01-snapshot-status.sh" "${forward_flags[@]}" || echo "STEP01_FAILED")"
echo "$step01_out"

# ---- Step 02 ----------------------------------------------------------------
log INFO "→ step 02 (RDS PITR restore) — start cronómetro"
RTO_START_EPOCH="$(epoch_now)"
step02_out="$("$HERE/02-rds-pitr-restore.sh" "${forward_flags[@]}")" || true
echo "$step02_out"

# Parse step 02 outputs.
RESTORED_DB_IDENTIFIER="$(awk -F= '/^RESTORED_DB_IDENTIFIER=/ { print $2 }' <<<"$step02_out" | tail -n1)"
RESTORED_DB_ENDPOINT="$(awk -F= '/^RESTORED_DB_ENDPOINT=/ { print $2 }' <<<"$step02_out" | tail -n1)"
TARGET_TIMESTAMP="$(awk -F= '/^TARGET_TIMESTAMP=/ { print $2 }' <<<"$step02_out" | tail -n1)"
RTO_SECONDS="$(awk -F= '/^RTO_SECONDS=/ { print $2 }' <<<"$step02_out" | tail -n1)"

export RESTORED_DB_IDENTIFIER RESTORED_DB_ENDPOINT

# ---- Step 04 ----------------------------------------------------------------
log INFO "→ step 04 (validate restored DB) — stop cronómetro"
step04_out="$("$HERE/04-validate-restored-db.sh" "${forward_flags[@]}" || true)"
echo "$step04_out"
RTO_END_EPOCH="$(epoch_now)"

LAST_AUDIT_TS="$(awk -F= '/^VALIDATION_LAST_AUDIT_TS=/ { print $2 }' <<<"$step04_out" | tail -n1)"
VALIDATION_STATUS="$(awk -F= '/^VALIDATION_STATUS=/ { print $2 }' <<<"$step04_out" | tail -n1)"

# ---- RTO / RPO calc ---------------------------------------------------------
total_rto=$(( RTO_END_EPOCH - RTO_START_EPOCH ))
human_rto=$(printf '%dh%02dm%02ds' $((total_rto/3600)) $(((total_rto%3600)/60)) $((total_rto%60)))

# RPO = (TARGET_TIMESTAMP) - (last write that persisted in restored DB).
# We approximate "last persisted write" with MAX(AuditLog.createdAt) returned
# by step 04. If LAST_AUDIT_TS > TARGET_TIMESTAMP we report 0 (over-restored,
# possible if PITR rounded up to next 5-min boundary).
rpo_seconds="n/a"
if [[ -n "$LAST_AUDIT_TS" && -n "$TARGET_TIMESTAMP" && "$DRY_RUN" != "1" ]]; then
  target_epoch=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$TARGET_TIMESTAMP" +%s 2>/dev/null \
              || date -u -d "$TARGET_TIMESTAMP" +%s 2>/dev/null \
              || echo 0)
  audit_epoch=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "${LAST_AUDIT_TS%.*}" +%s 2>/dev/null \
              || date -u -d "$LAST_AUDIT_TS" +%s 2>/dev/null \
              || echo 0)
  if [[ $target_epoch -gt 0 && $audit_epoch -gt 0 ]]; then
    diff=$(( target_epoch - audit_epoch ))
    [[ $diff -lt 0 ]] && diff=0
    rpo_seconds=$diff
  fi
fi

# ---- Summary ----------------------------------------------------------------
{
  echo
  echo "## DR drill summary — $DRILL_START_HUMAN"
  echo
  echo "| Field | Value |"
  echo "|---|---|"
  echo "| Drill started        | $DRILL_START_HUMAN |"
  echo "| Restored identifier  | ${RESTORED_DB_IDENTIFIER:-<dry-run>} |"
  echo "| Restored endpoint    | ${RESTORED_DB_ENDPOINT:-<dry-run>} |"
  echo "| Target timestamp     | ${TARGET_TIMESTAMP:-<n/a>} |"
  echo "| Last audit row in DB | ${LAST_AUDIT_TS:-<n/a>} |"
  echo "| RTO (seconds)        | ${total_rto} |"
  echo "| RTO (human)          | ${human_rto} |"
  echo "| RTO target           | 14400s (4h) |"
  echo "| RPO (seconds)        | ${rpo_seconds} |"
  echo "| RPO target           | 900s (15min) |"
  echo "| Validation status    | ${VALIDATION_STATUS:-<n/a>} |"
  echo
  echo "### Next steps"
  echo
  echo "1. Paste this summary into \`docs/dr-drills/$(date -u +%F)-staging.md\`."
  echo "2. Attach script logs from \`$LOG_DIR\`."
  echo "3. Run \`scripts/dr-drill/05-cleanup.sh --identifier ${RESTORED_DB_IDENTIFIER:-<id>}\` after stakeholder review."
} | tee "$SUMMARY_FILE"

log OK "orchestrator complete — summary at $SUMMARY_FILE"

# ---- Publish DR.DrillFreshnessDays metric -----------------------------------
# G-1 Sprint 5 iter 2.
#
# El módulo Terraform `dr-drill-alarm` configura una alarma sobre la métrica
# custom `SegurAsist/DR.DrillFreshnessDays` con `treat_missing_data=breaching`
# y umbral 30d. Al cierre de un drill exitoso publicamos `value=0` para
# resetear el contador "días desde último drill". CloudWatch interpreta la
# ausencia de datapoints subsecuentes como breaching ⇒ después de 30 días sin
# nuevo drill, la alarma dispara y SNS notifica #ops.
#
# Criterio de éxito = VALIDATION_STATUS == PASS. Si el drill falló o validación
# devolvió FAIL, NO publicamos el reset (queremos que la alarma siga avanzando).
#
# Dimension `Environment` debe coincidir con la del módulo TF (default
# "staging"). El env var `DR_ENVIRONMENT` la sobre-escribe en CI.

DR_METRIC_ENV="${DR_ENVIRONMENT:-staging}"
DR_METRIC_NS="SegurAsist/DR"
DR_METRIC_NAME="DrillFreshnessDays"
DR_METRIC_TS="$(date -u +%FT%TZ)"

if [[ "${VALIDATION_STATUS:-}" == "PASS" ]]; then
  log INFO "publishing custom metric $DR_METRIC_NS/$DR_METRIC_NAME=0 (env=$DR_METRIC_ENV)"
  run_or_echo aws cloudwatch put-metric-data \
    --namespace "$DR_METRIC_NS" \
    --metric-name "$DR_METRIC_NAME" \
    --value 0 \
    --unit Count \
    --timestamp "$DR_METRIC_TS" \
    --dimensions "Environment=$DR_METRIC_ENV"
else
  log WARN "VALIDATION_STATUS != PASS (was '${VALIDATION_STATUS:-<unset>}') — NOT resetting DrillFreshnessDays metric. The alarm will continue to advance."
fi
