#!/usr/bin/env bash
# Bring-up completo del stack local de SegurAsist.
# Idempotente: puedes correrlo varias veces sin efectos colaterales.
#
# Uso:
#   cd /Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/segurasist-api
#   ./scripts/local-up.sh
#
# Requiere: Docker Desktop corriendo, Node 20.x, AWS CLI, psql.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${API_DIR}"

step() { printf "\n\033[1;36m== %s ==\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1" >&2; exit 1; }

# -------------------------------------------------------------------------
# 0) Pre-checks
# -------------------------------------------------------------------------
step "Pre-checks"

command -v docker >/dev/null 2>&1 || fail "docker no está en PATH. Instala Docker Desktop y ábrelo."
docker info >/dev/null 2>&1 || fail "Docker no responde. Abre Docker Desktop y espera a que esté 'Running'."
ok "docker daemon OK"

command -v node >/dev/null 2>&1 || fail "node no está en PATH (instala Node 20.x)."
NODE_MAJOR=$(node -v | sed -E 's/^v([0-9]+).*/\1/')
[[ "${NODE_MAJOR}" == "20" ]] || printf "  \033[33m⚠\033[0m  node v$(node -v) — el proyecto pide Node 20.x\n"
ok "node $(node -v)"

command -v aws >/dev/null 2>&1 || fail "aws CLI no está en PATH (brew install awscli)."
ok "aws $(aws --version 2>&1 | head -c 30)"

command -v psql >/dev/null 2>&1 || fail "psql no está en PATH (brew install libpq && brew link --force libpq)."
ok "psql disponible"

# -------------------------------------------------------------------------
# 1) docker compose up
# -------------------------------------------------------------------------
step "Levantando docker-compose (postgres, redis, localstack, mailpit, cognito-local)"
docker compose up -d
ok "compose up disparado"

step "Esperando healthy (hasta 60s)"
for i in $(seq 1 60); do
  UNHEALTHY=$(docker compose ps --format json 2>/dev/null | grep -c '"Health":"unhealthy"\|"Health":"starting"' || true)
  if [[ "${UNHEALTHY}" == "0" ]]; then
    ok "todos healthy"
    break
  fi
  sleep 1
  if [[ $i -eq 60 ]]; then
    docker compose ps
    fail "Algunos servicios no llegaron a healthy en 60s."
  fi
done

# -------------------------------------------------------------------------
# 2) npm install (si node_modules falta)
# -------------------------------------------------------------------------
if [[ ! -d node_modules ]]; then
  step "npm install"
  npm install
  ok "deps instaladas"
else
  ok "node_modules ya existe (saltando npm install)"
fi

# -------------------------------------------------------------------------
# 3) .env
# -------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  step "Creando .env desde .env.example"
  cp .env.example .env
  # LocalStack 3.7 no reconoce mx-central-1; forzamos us-east-1 solo localmente.
  # Prod sigue siendo mx-central-1 (vía Secrets Manager + Terraform en Sprint 5).
  sed -i.bak 's/^AWS_REGION=.*/AWS_REGION=us-east-1/' .env && rm -f .env.bak
  cat >> .env <<'EOF'

# ---- Overrides local-first (añadidos por local-up.sh) ----
AWS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
COGNITO_REGION=local
COGNITO_ENDPOINT=http://0.0.0.0:9229
EMAIL_TRANSPORT=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
EOF
  ok ".env creado (AWS_REGION=us-east-1 para LocalStack)"
else
  # Si .env ya existe, parchea AWS_REGION si todavía está en mx-central-1
  if grep -q '^AWS_REGION=mx-central-1' .env; then
    sed -i.bak 's/^AWS_REGION=mx-central-1/AWS_REGION=us-east-1/' .env && rm -f .env.bak
    ok ".env: AWS_REGION mx-central-1 → us-east-1 (LocalStack no soporta mx-central-1)"
  fi

  # Sprint 4 — append vars introducidas por S4 si falta alguna en .env legacy.
  # Nombre por nombre (no append blob) para evitar duplicar si solo falta una.
  S4_VARS=(
    "SQS_QUEUE_INSUREDS_CREATION=http://localhost:4566/000000000000/insureds-creation"
    "SQS_QUEUE_MONTHLY_REPORTS=http://localhost:4566/000000000000/monthly-reports"
    "MONTHLY_REPORT_RECIPIENTS=ops@segurasist.local,admin-mac@hospitalesmac.local"
    "INSURED_DEFAULT_PASSWORD=DevLocal-PleaseChange-9!"
  )
  added=0
  for kv in "${S4_VARS[@]}"; do
    key="${kv%%=*}"
    if ! grep -q "^${key}=" .env; then
      printf '\n%s\n' "${kv}" >> .env
      added=$((added+1))
    fi
  done
  if [[ $added -gt 0 ]]; then
    ok ".env: ${added} var(s) S4 agregadas"
  else
    ok ".env ya tiene S4 vars"
  fi
fi

# -------------------------------------------------------------------------
# 4) LocalStack bootstrap
# -------------------------------------------------------------------------
step "LocalStack bootstrap (S3 + SQS + KMS)"
"${SCRIPT_DIR}/localstack-bootstrap.sh"

# -------------------------------------------------------------------------
# 5) Prisma migrate + RLS + seed
# -------------------------------------------------------------------------
step "Prisma migrate deploy"
npx prisma migrate deploy

step "Aplicando RLS policies"
"${SCRIPT_DIR}/apply-rls.sh"

step "Prisma db seed"
npx prisma db seed

# -------------------------------------------------------------------------
# 6) Cognito-local bootstrap
# -------------------------------------------------------------------------
step "Cognito-local bootstrap (pools + clients + admin user)"
"${SCRIPT_DIR}/cognito-local-bootstrap.sh"

# -------------------------------------------------------------------------
# 7) Done
# -------------------------------------------------------------------------
step "Stack local listo"
cat <<'EOF'

  Próximos pasos:
    1) Pega los COGNITO_* IDs que imprimió el bootstrap en .env (sección 6 arriba)
    2) En esta terminal: npm run dev          → API en http://localhost:3000
    3) En otra terminal: cd ../segurasist-web && pnpm install && pnpm --filter admin dev
    4) Mailpit (emails capturados):           http://localhost:8025
    5) Verifica RLS contra DB real:           npm run test:cross-tenant

  Login admin (en /login del frontend):
    email:    admin@mac.local
    password: Admin123!

EOF
