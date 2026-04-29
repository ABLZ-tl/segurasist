#!/usr/bin/env bash
# S5-2 iter 2 — build script for security-alarms lambdas.
#
# Outputs:
#   dist/slack-forwarder.zip
#   dist/quarantine.zip
#
# Each zip contains: index.mjs, package.json, node_modules/.
#
# Usage:
#   cd segurasist-infra/modules/security-alarms/lambdas
#   ./build.sh
#
# Pre-reqs: node >= 20, npm. Note: AWS SDK v3 clients are bundled with
# the Lambda Node.js 20 runtime ALREADY — but we vendor them here for
# explicit version pinning + offline cold-start parity. If size becomes
# an issue, switch to `npm install --omit=optional` and rely on the
# runtime SDK (saves ~8MB per zip).

set -euo pipefail

LAMBDAS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${LAMBDAS_DIR}/dist"
LAMBDAS=("slack-forwarder" "quarantine")

mkdir -p "${DIST_DIR}"

for name in "${LAMBDAS[@]}"; do
  src="${LAMBDAS_DIR}/${name}"
  if [[ ! -d "${src}" ]]; then
    echo "ERROR: ${src} not found" >&2
    exit 1
  fi

  echo ">>> building ${name}"
  pushd "${src}" >/dev/null

  # Clean install for reproducible zip.
  rm -rf node_modules
  npm install --omit=dev --no-audit --no-fund --silent

  zip_path="${DIST_DIR}/${name}.zip"
  rm -f "${zip_path}"

  # Zip top-level: index.mjs + package.json + node_modules/.
  zip -rq "${zip_path}" index.mjs package.json node_modules

  size_kb=$(du -k "${zip_path}" | cut -f1)
  echo "    wrote ${zip_path} (${size_kb} KB)"

  popd >/dev/null
done

echo "OK — artifacts in ${DIST_DIR}/"
ls -lh "${DIST_DIR}"
