#!/usr/bin/env bash
# Sprint 4 — S4-10. Parser de archivos JTL (JMeter result CSV) → métricas
# agregadas en JSON consumibles por el CI gate.
#
# Espera JTL con headers (saveConfig fieldNames=true). Calcula:
#   total, errors, errorRatePct, p50, p95, p99, avg, max (en ms)
#
# Uso:
#   parse-jtl.sh path/to/results.jtl [LABEL_FILTER]
#
# El parámetro LABEL_FILTER es opcional. Si se pasa, sólo agrega samples
# cuyo `label` haga match exacto (ej. "GET /v1/insureds/me"). Útil para
# breakdown por endpoint.
#
# Output JSON ejemplo:
#   {
#     "total": 12345, "errors": 12, "errorRatePct": 0.0972,
#     "p50": 120, "p95": 380, "p99": 612, "avg": 145, "max": 1820
#   }
#
# Requiere: awk, sort, jq.

set -euo pipefail

JTL="${1:-}"
LABEL="${2:-}"

if [[ -z "$JTL" || ! -f "$JTL" ]]; then
  echo "Usage: $0 <results.jtl> [LABEL_FILTER]" >&2
  exit 2
fi

# 1) Detectar índices de las columnas que necesitamos en el header.
HEADER=$(head -n1 "$JTL")
IFS=',' read -r -a COLS <<<"$HEADER"

idx_of() {
  local needle="$1"
  for i in "${!COLS[@]}"; do
    if [[ "${COLS[$i]}" == "$needle" ]]; then echo "$i"; return; fi
  done
  echo "-1"
}

I_ELAPSED=$(idx_of "elapsed")
I_LABEL=$(idx_of "label")
I_SUCCESS=$(idx_of "success")
I_CODE=$(idx_of "responseCode")

if [[ "$I_ELAPSED" == "-1" || "$I_SUCCESS" == "-1" ]]; then
  echo "JTL missing required columns (elapsed,success). Header: $HEADER" >&2
  exit 3
fi

# 2) Filtrar + extraer elapsed + success/error en un solo awk.
TMP_LAT=$(mktemp)
TMP_ERR=$(mktemp)
trap 'rm -f "$TMP_LAT" "$TMP_ERR"' EXIT

awk -F',' -v ie="$((I_ELAPSED+1))" -v il="$((I_LABEL+1))" -v is="$((I_SUCCESS+1))" \
    -v label="$LABEL" \
    -v lat="$TMP_LAT" -v err="$TMP_ERR" '
  NR==1 { next }
  {
    if (label != "" && $il != label) next
    print $ie >> lat
    if ($is != "true") print 1 >> err
    else print 0 >> err
  }
' "$JTL"

TOTAL=$(wc -l <"$TMP_LAT" | tr -d ' ')
if [[ "$TOTAL" -eq 0 ]]; then
  jq -n '{total:0, errors:0, errorRatePct:0, p50:0, p95:0, p99:0, avg:0, max:0}'
  exit 0
fi

ERRORS=$(awk '{s+=$1} END{print s+0}' "$TMP_ERR")
ERR_PCT=$(awk -v e="$ERRORS" -v t="$TOTAL" 'BEGIN{printf "%.4f", (e/t)*100}')

# 3) Percentiles vía sort + nth-line.
sort -n "$TMP_LAT" -o "$TMP_LAT"
percentile() {
  local p="$1"
  awk -v p="$p" -v t="$TOTAL" 'BEGIN{
    n = int((p/100.0)*t + 0.5)
    if (n < 1) n = 1
    if (n > t) n = t
  } NR==n {print $1; exit}' "$TMP_LAT"
}
P50=$(percentile 50)
P95=$(percentile 95)
P99=$(percentile 99)
AVG=$(awk '{s+=$1; n++} END{if(n>0) printf "%.0f", s/n; else print 0}' "$TMP_LAT")
MAX=$(tail -n1 "$TMP_LAT")

jq -n \
  --argjson total "$TOTAL" \
  --argjson errors "$ERRORS" \
  --argjson errPct "$ERR_PCT" \
  --argjson p50 "$P50" \
  --argjson p95 "$P95" \
  --argjson p99 "$P99" \
  --argjson avg "$AVG" \
  --argjson max "$MAX" \
  '{total:$total, errors:$errors, errorRatePct:$errPct, p50:$p50, p95:$p95, p99:$p99, avg:$avg, max:$max}'
