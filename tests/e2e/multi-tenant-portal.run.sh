#!/usr/bin/env bash
# Sprint 5 — MT-4 — Run all multi-tenant + visual regression E2E tests.
#
# Asume que el stack local está corriendo:
#   - postgres :5432, redis, localstack, mailpit :8025, cognito-local :9229
#   - API NestJS :3000
#   - admin Next.js :3001
#   - portal Next.js :3002
#
# Y que el seed multi-tenant fue corrido:
#   pnpm --filter segurasist-api ts-node prisma/seed-multi-tenant.ts
#
# Uso:
#   bash tests/e2e/multi-tenant-portal.run.sh
#   CI=1 bash tests/e2e/multi-tenant-portal.run.sh    # CI mode (sin video, retries)
#
# Resultados → tests/e2e/reports/sprint5-<ISO_TIMESTAMP>/

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TS=$(date -u +"%Y%m%dT%H%M%SZ")
REPORT_DIR="${REPO_ROOT}/tests/e2e/reports/sprint5-${TS}"
HTML_DIR="${REPORT_DIR}/html"
TR_DIR="${REPORT_DIR}/test-results"

mkdir -p "${HTML_DIR}" "${TR_DIR}"

echo "[mt-4] timestamp=${TS}"
echo "[mt-4] report_dir=${REPORT_DIR}"

# Smoke check — abortar temprano si algo no responde.
check_url() {
  local url="$1"
  local label="$2"
  if curl -sSf -o /dev/null --max-time 5 "$url"; then
    echo "[mt-4] ✓ ${label} (${url})"
  else
    echo "[mt-4] ✗ ${label} NOT REACHABLE (${url})"
    return 1
  fi
}

echo "[mt-4] smoke checks…"
SMOKE_FAIL=0
check_url "http://localhost:3000/v1/health" "API NestJS" || SMOKE_FAIL=1
check_url "http://localhost:3001" "Admin Next.js" || SMOKE_FAIL=1
check_url "http://localhost:3002" "Portal Next.js" || SMOKE_FAIL=1
check_url "http://localhost:8025/api/v1/messages" "Mailpit" || SMOKE_FAIL=1

if [ $SMOKE_FAIL -ne 0 ]; then
  echo "[mt-4] WARNING: stack incompleto — los tests con flow real fallarán/skipearán."
  echo "[mt-4] continuando para que los .skip se reporten en el HTML report."
fi

# Playwright deps — usa el binario de segurasist-web (ya instalado allí).
PW_BIN="${REPO_ROOT}/segurasist-web/node_modules/.bin/playwright"
if [ ! -x "${PW_BIN}" ]; then
  echo "[mt-4] FATAL: playwright binary no encontrado en ${PW_BIN}"
  echo "[mt-4]   ejecuta: cd segurasist-web && pnpm install"
  exit 2
fi

CONFIG="${REPO_ROOT}/tests/e2e/playwright.config.ts"

# Forzar destino del HTML report (Playwright lee PLAYWRIGHT_HTML_REPORT cuando
# se pasa `--reporter=html` por CLI). Ver
# https://playwright.dev/docs/test-reporters#html-reporter
export PLAYWRIGHT_HTML_REPORT="${HTML_DIR}/playwright-report"
export PLAYWRIGHT_HTML_OPEN="never"

set +e
"${PW_BIN}" test \
  --config="${CONFIG}" \
  --reporter=list,html \
  --output="${TR_DIR}"
EXIT_CODE=$?
set -e

echo "[mt-4] exit_code=${EXIT_CODE}"
echo "[mt-4] report_dir=${REPORT_DIR}"
echo "[mt-4] open HTML: file://${HTML_DIR}/playwright-report/index.html"

exit ${EXIT_CODE}
