#!/usr/bin/env bash
# Common helpers for DR drill scripts (sourced, not executed).
#
# Public surface:
#   parse_common_flags "$@"   → sets DRY_RUN (0|1) and re-exports remaining args
#                                in $REMAINING_ARGS (array).
#   log INFO|WARN|ERROR <msg> → timestamped log line.
#   require <cmd> [<cmd> ...] → ensure binaries are on PATH.
#   assert_not_prod           → fails if AWS account ID looks like prod or
#                                identifier contains "-prod-".
#   run_or_echo <cmd...>      → executes the command (or prints it if dry-run).
#   ts_iso                    → ISO-8601 timestamp UTC (no colons, suitable for
#                                AWS resource identifiers).
#   ts_human                  → human ISO-8601 timestamp UTC (with colons).
#   epoch_now                 → UNIX epoch seconds.
#
# This file refuses to be executed directly.

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "[_lib.sh] This file must be sourced, not executed." >&2
  exit 2
fi

set -uo pipefail

DRY_RUN="${DR_DRILL_DRY_RUN:-}"
if [[ -z "${DRY_RUN}" ]]; then
  # Default to dry-run if no AWS profile is configured. Safer than the inverse.
  if [[ -z "${AWS_PROFILE:-}" && -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
    DRY_RUN=1
  else
    DRY_RUN=0
  fi
fi

REMAINING_ARGS=()

parse_common_flags() {
  REMAINING_ARGS=()
  while (( "$#" )); do
    case "$1" in
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --no-dry-run)
        DRY_RUN=0
        shift
        ;;
      --help|-h)
        # Caller prints its own usage; we just exit.
        echo "see: ${0##*/} --help"
        ;& # fallthrough
      *)
        REMAINING_ARGS+=("$1")
        shift
        ;;
    esac
  done
  export DRY_RUN
}

log() {
  local level="$1"; shift
  local color_reset=$'\033[0m'
  local color=""
  case "$level" in
    INFO)  color=$'\033[0;36m' ;;
    WARN)  color=$'\033[0;33m' ;;
    ERROR) color=$'\033[0;31m' ;;
    OK)    color=$'\033[0;32m' ;;
  esac
  printf '%s[%s] %s %s%s\n' "$color" "$level" "$(ts_human)" "$*" "$color_reset" >&2
}

require() {
  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      log ERROR "missing required command: $cmd"
      exit 127
    fi
  done
}

ts_iso() {
  date -u +"%Y%m%dT%H%M%SZ"
}

ts_human() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

epoch_now() {
  date -u +%s
}

assert_not_prod() {
  # Refuse to run against the prod account or against an identifier containing
  # "-prod-". The check is best-effort: if AWS CLI is unavailable (dry-run on
  # a dev laptop) we skip but log a warning.
  local id_like="${1:-}"
  if [[ "$id_like" == *"-prod-"* ]]; then
    log ERROR "identifier '$id_like' looks like prod — refusing to continue."
    exit 3
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    return 0
  fi
  if ! command -v aws >/dev/null 2>&1; then
    log WARN "aws CLI missing — cannot verify account; running anyway because --no-dry-run was passed."
    return 0
  fi
  local account
  account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")"
  if [[ -z "$account" ]]; then
    log ERROR "could not resolve AWS account ID — refusing to continue."
    exit 4
  fi
  # The prod account ID is intentionally NOT hardcoded here — the runbook
  # validates it out-of-band and CI sets DR_PROD_ACCOUNT_ID via OIDC env.
  if [[ -n "${DR_PROD_ACCOUNT_ID:-}" && "$account" == "${DR_PROD_ACCOUNT_ID}" ]]; then
    log ERROR "AWS account $account matches DR_PROD_ACCOUNT_ID — aborting."
    exit 5
  fi
  log INFO "AWS account check passed: $account (DR runner)."
}

run_or_echo() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[DRY-RUN] %s\n' "$*" >&2
    return 0
  fi
  "$@"
}

# Defensive credential leak check: refuse to run if AWS_ACCESS_KEY_ID was
# passed via positional flags (we never want a script that accepts secrets
# on argv).
assert_no_creds_in_argv() {
  for arg in "$@"; do
    case "$arg" in
      *AKIA*|*ASIA*|--access-key=*|--secret-key=*|--aws-access-key-id=*)
        log ERROR "AWS credentials must not be passed via CLI flags."
        exit 6
        ;;
    esac
  done
}

# Logs directory (gitignored under .dr-drill-logs/).
log_dir() {
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  local dir="$root/.dr-drill-logs/$(ts_iso)"
  mkdir -p "$dir"
  printf '%s' "$dir"
}
