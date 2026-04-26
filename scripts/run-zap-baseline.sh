#!/usr/bin/env bash
# scripts/run-zap-baseline.sh — S2-08
#
# Corre OWASP ZAP baseline scan local contra la API o las apps web.
#
# Usage:
#   ./scripts/run-zap-baseline.sh [api|admin|portal] [--full]
#
# Pre:
#   - Docker Desktop arriba (host.docker.internal resoluble desde el contenedor).
#   - El target debe estar respondiendo en su puerto local antes de lanzar ZAP:
#       api    → http://localhost:3000/v1/openapi.json
#       admin  → http://localhost:3001/login
#       portal → http://localhost:3002/
#     Para `api`, además: `cd segurasist-api && docker compose up -d` y luego
#     `npm run dev` (o `node dist/main.js`).
#
# Output:
#   .zap-reports/<target>-<timestamp>.html (+ .json + .md)
#
# `--full` cambia a zap-full-scan.py (active scan, ~30 min en lugar de ~5-8).

set -euo pipefail

TARGET_NAME="${1:-}"
MODE_FLAG="${2:-}"

if [[ -z "${TARGET_NAME}" ]]; then
  echo "Usage: $0 [api|admin|portal] [--full]" >&2
  exit 64
fi

case "${TARGET_NAME}" in
  api)    PORT=3000; PATH_PART="v1/openapi.json" ;;
  admin)  PORT=3001; PATH_PART="login" ;;
  portal) PORT=3002; PATH_PART="" ;;
  *)
    echo "Error: target inválido '${TARGET_NAME}' (esperado: api|admin|portal)" >&2
    exit 64
    ;;
esac

USE_FULL=0
if [[ "${MODE_FLAG}" == "--full" ]]; then
  USE_FULL=1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORT_DIR="${REPO_ROOT}/.zap-reports"
mkdir -p "${REPORT_DIR}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_BASE="${TARGET_NAME}-${TIMESTAMP}"

# ---- Pre: docker check -------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker no está instalado / en PATH." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker daemon no está corriendo. Inicia Docker Desktop." >&2
  exit 1
fi

# ---- Pre: docker compose stack arriba (sólo target=api) ----------------------
if [[ "${TARGET_NAME}" == "api" ]]; then
  COMPOSE_FILE="${REPO_ROOT}/segurasist-api/docker-compose.yml"
  if ! docker compose -f "${COMPOSE_FILE}" ps --format json 2>/dev/null \
        | grep -q '"State":"running"'; then
    echo "Error: el stack de segurasist-api no está arriba." >&2
    echo "  Ejecuta: cd segurasist-api && docker compose up -d" >&2
    exit 1
  fi
fi

# ---- Pre: target respondiendo ------------------------------------------------
TARGET_URL_LOCAL="http://localhost:${PORT}/${PATH_PART}"
if ! curl -fsS -o /dev/null -m 5 "${TARGET_URL_LOCAL}"; then
  echo "Error: ${TARGET_URL_LOCAL} no responde." >&2
  case "${TARGET_NAME}" in
    api)    echo "  Arranca la API: cd segurasist-api && npm run dev" >&2 ;;
    admin)  echo "  Arranca admin: cd segurasist-web && pnpm --filter @segurasist/admin dev" >&2 ;;
    portal) echo "  Arranca portal: cd segurasist-web && pnpm --filter @segurasist/portal dev" >&2 ;;
  esac
  exit 1
fi

# ---- Pick image + script -----------------------------------------------------
IMAGE="ghcr.io/zaproxy/zaproxy:stable"
if [[ "${USE_FULL}" -eq 1 ]]; then
  ZAP_SCRIPT="zap-full-scan.py"
  echo "[zap] Modo FULL (active scan, ~30 min)."
else
  ZAP_SCRIPT="zap-baseline.py"
  echo "[zap] Modo BASELINE (passive scan, ~5-8 min)."
fi

# Target URL desde dentro del contenedor → host.docker.internal
TARGET_URL_DOCKER="http://host.docker.internal:${PORT}/${PATH_PART}"

RULES_FILE_HOST="${REPO_ROOT}/.zap/rules.tsv"
RULES_FLAG=()
if [[ -f "${RULES_FILE_HOST}" ]]; then
  RULES_FLAG+=("-c" "/zap/wrk/rules.tsv")
  cp "${RULES_FILE_HOST}" "${REPORT_DIR}/rules.tsv"
fi

echo "[zap] Target  : ${TARGET_URL_DOCKER}"
echo "[zap] Reports : ${REPORT_DIR}/${REPORT_BASE}.{html,json,md}"

# `-a` includes alpha rules; `-j` AJAX spider; `-m 5` minutes for spider.
# `-I` no devolver exit≠0 si hay WARNs (sólo FAIL = exit≠0); queremos ese
# comportamiento para el script local (informativo). En CI usamos action oficial
# con fail_action=true.
set +e
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v "${REPORT_DIR}:/zap/wrk/:rw" \
  -t "${IMAGE}" \
  "${ZAP_SCRIPT}" \
    -t "${TARGET_URL_DOCKER}" \
    -a -j -m 5 \
    "${RULES_FLAG[@]}" \
    -r "${REPORT_BASE}.html" \
    -J "${REPORT_BASE}.json" \
    -w "${REPORT_BASE}.md" \
    -I
ZAP_EXIT=$?
set -e

echo
echo "[zap] Done. Exit code: ${ZAP_EXIT}"
echo "[zap] Abre el reporte HTML:"
echo "      open ${REPORT_DIR}/${REPORT_BASE}.html"
echo
echo "Resumen markdown (primeras líneas):"
head -n 40 "${REPORT_DIR}/${REPORT_BASE}.md" 2>/dev/null || true

exit "${ZAP_EXIT}"
