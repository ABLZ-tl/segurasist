#!/usr/bin/env bash
# Bootstrap de cognito-local: 2 user pools (admin + insured), clients, y los
# 5 admin/operativo/supervisor/insured users que cubren la matriz RBAC del
# Sprint 1. Sincroniza `users.cognito_sub` con el sub real que cognito-local
# le asigna a cada usuario.
#
# Idempotente: detecta lo que ya existe y solo crea / actualiza lo faltante.
#
# Pre-requisitos:
#   1) `docker compose up -d` (cognito-local healthy en :9229)
#   2) `prisma db seed` ya corrido (necesitamos el tenant_id del tenant `mac`
#      y la fila correspondiente en `users` para sincronizar `cognito_sub`)
#
# Uso:
#   ./scripts/cognito-local-bootstrap.sh
#
# Variables opcionales (con defaults):
#   COGNITO_ENDPOINT   default http://localhost:9229
#   AWS_REGION         default local (cognito-local lo ignora pero el CLI lo exige)
#   PGURL              default postgresql://segurasist:segurasist@localhost:5432/segurasist
#   ADMIN_EMAIL        default admin@mac.local        (debe coincidir con seed.ts)
#   ADMIN_PASSWORD     default Admin123!
#   DEMO_PASSWORD      default Demo123!  (resto de los seed users)
#   POOL_ADMIN         default local_admin
#   POOL_INSURED       default local_insured
#   CLIENT_ADMIN       default local-admin-client
#   CLIENT_INSURED     default local-insured-client

set -euo pipefail

COGNITO_ENDPOINT="${COGNITO_ENDPOINT:-http://localhost:9229}"
AWS_REGION="${AWS_REGION:-local}"
PGURL="${PGURL:-postgresql://segurasist:segurasist@localhost:5432/segurasist}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@mac.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin123!}"
DEMO_PASSWORD="${DEMO_PASSWORD:-Demo123!}"
POOL_ADMIN="${POOL_ADMIN:-local_admin}"
POOL_INSURED="${POOL_INSURED:-local_insured}"
CLIENT_ADMIN="${CLIENT_ADMIN:-local-admin-client}"
CLIENT_INSURED="${CLIENT_INSURED:-local-insured-client}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="${AWS_REGION}"

for tool in aws psql jq curl; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "[cognito-local-bootstrap] FATAL: '${tool}' no está en PATH" >&2
    exit 1
  fi
done

cog() { aws --endpoint-url="${COGNITO_ENDPOINT}" --region "${AWS_REGION}" cognito-idp "$@"; }

# Esperar a cognito-local
echo "[cognito-local-bootstrap] esperando cognito-local en ${COGNITO_ENDPOINT} ..."
for i in $(seq 1 30); do
  if curl -sS -o /dev/null -w "%{http_code}" "${COGNITO_ENDPOINT}/" 2>/dev/null | grep -qE "^(200|400|404)$"; then
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "[cognito-local-bootstrap] FATAL: cognito-local no respondió en 30s." >&2
    exit 2
  fi
  sleep 1
done
echo "[cognito-local-bootstrap] cognito-local OK"

# =========================================================================
# 1) Recuperar tenant_id del seed (tenant slug=mac)
# =========================================================================
TENANT_ID=$(psql "${PGURL}" -tAc "SELECT id FROM tenants WHERE slug='mac' LIMIT 1;" 2>/dev/null | tr -d '[:space:]' || true)
if [[ -z "${TENANT_ID}" ]]; then
  echo "[cognito-local-bootstrap] FATAL: no encuentro tenant slug='mac' en la BD." >&2
  echo "  ¿corriste 'npx prisma db seed' antes?" >&2
  exit 3
fi
echo "[tenant] mac → ${TENANT_ID}"

# =========================================================================
# 2) Helper: crear pool si no existe (cognito-local acepta el Id como nombre)
# =========================================================================
ensure_pool() {
  local pool_name="$1"
  local existing
  existing=$(cog list-user-pools --max-results 60 --query "UserPools[?Name=='${pool_name}'].Id | [0]" --output text 2>/dev/null || echo "None")
  if [[ "${existing}" != "None" && -n "${existing}" ]]; then
    echo "${existing}"
    return 0
  fi
  cog create-user-pool \
    --pool-name "${pool_name}" \
    --policies "PasswordPolicy={MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true}" \
    --schema \
      "Name=email,AttributeDataType=String,Required=true,Mutable=true" \
      "Name=tenant_id,AttributeDataType=String,Required=false,Mutable=true,DeveloperOnlyAttribute=false" \
      "Name=role,AttributeDataType=String,Required=false,Mutable=true,DeveloperOnlyAttribute=false" \
    --auto-verified-attributes email \
    --query 'UserPool.Id' --output text
}

ensure_client() {
  local pool_id="$1"
  local client_name="$2"
  local existing
  existing=$(cog list-user-pool-clients --user-pool-id "${pool_id}" --max-results 60 \
    --query "UserPoolClients[?ClientName=='${client_name}'].ClientId | [0]" --output text 2>/dev/null || echo "None")
  if [[ "${existing}" != "None" && -n "${existing}" ]]; then
    echo "${existing}"
    return 0
  fi
  cog create-user-pool-client \
    --user-pool-id "${pool_id}" \
    --client-name "${client_name}" \
    --explicit-auth-flows ALLOW_ADMIN_USER_PASSWORD_AUTH ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --query 'UserPoolClient.ClientId' --output text
}

ADMIN_POOL_ID=$(ensure_pool "${POOL_ADMIN}")
echo "[pool] admin   → ${ADMIN_POOL_ID}"
INSURED_POOL_ID=$(ensure_pool "${POOL_INSURED}")
echo "[pool] insured → ${INSURED_POOL_ID}"

ADMIN_CLIENT_ID=$(ensure_client "${ADMIN_POOL_ID}" "${CLIENT_ADMIN}")
echo "[client] admin   → ${ADMIN_CLIENT_ID}"
INSURED_CLIENT_ID=$(ensure_client "${INSURED_POOL_ID}" "${CLIENT_INSURED}")
echo "[client] insured → ${INSURED_CLIENT_ID}"

# =========================================================================
# 3) Crear / actualizar usuarios — uno por rol del enum UserRole
# =========================================================================
# ensure_user POOL_ID EMAIL ROLE TENANT_ATTR PASSWORD
#   TENANT_ATTR es lo que se mete en custom:tenant_id. Para superadmin
#   (`role=admin_segurasist`) pasamos cadena vacía — M2: el JwtAuthGuard
#   ahora detecta superadmin por `custom:role` y lo trata como cross-tenant
#   sin tenant context. El sentinel viejo `GLOBAL` quedó deprecado.
ensure_user() {
  local pool_id="$1"
  local email="$2"
  local role="$3"
  local tenant_attr="$4"
  local password="$5"

  local exists
  exists=$(cog admin-get-user \
    --user-pool-id "${pool_id}" \
    --username "${email}" \
    --query 'Username' --output text 2>/dev/null || echo "")

  # Construir el array de atributos: custom:tenant_id sólo si tenant_attr no vacío.
  local attrs_create=(
    "Name=email,Value=${email}"
    "Name=email_verified,Value=true"
    "Name=custom:role,Value=${role}"
  )
  local attrs_update=(
    "Name=custom:role,Value=${role}"
  )
  if [[ -n "${tenant_attr}" ]]; then
    attrs_create+=("Name=custom:tenant_id,Value=${tenant_attr}")
    attrs_update+=("Name=custom:tenant_id,Value=${tenant_attr}")
  fi

  if [[ -z "${exists}" || "${exists}" == "None" ]]; then
    echo "[user] creando ${email} en ${pool_id} (role=${role}, tenant=${tenant_attr:-<none>})"
    cog admin-create-user \
      --user-pool-id "${pool_id}" \
      --username "${email}" \
      --user-attributes "${attrs_create[@]}" \
      --message-action SUPPRESS >/dev/null

    cog admin-set-user-password \
      --user-pool-id "${pool_id}" \
      --username "${email}" \
      --password "${password}" \
      --permanent >/dev/null
  else
    echo "[user] ${email} existe — sincronizo custom:tenant_id / custom:role"
    cog admin-update-user-attributes \
      --user-pool-id "${pool_id}" \
      --username "${email}" \
      --user-attributes "${attrs_update[@]}" >/dev/null
    # Reset password permanente para que repetir el bootstrap deje pasar el e2e
    cog admin-set-user-password \
      --user-pool-id "${pool_id}" \
      --username "${email}" \
      --password "${password}" \
      --permanent >/dev/null
  fi
}

# sync_sub POOL_ID EMAIL — copia el sub que cognito-local generó a users.cognito_sub
sync_sub() {
  local pool_id="$1"
  local email="$2"
  local sub
  sub=$(cog admin-get-user \
    --user-pool-id "${pool_id}" \
    --username "${email}" \
    --query "UserAttributes[?Name=='sub'].Value | [0]" --output text 2>/dev/null || echo "")
  if [[ -z "${sub}" || "${sub}" == "None" ]]; then
    echo "[cognito-local-bootstrap] WARN: sub vacío para ${email}; salto sync" >&2
    return 0
  fi
  # Update por email — el placeholder seed-* se reescribe la primera vez,
  # las siguientes corridas son no-op (mismo sub).
  psql "${PGURL}" -v ON_ERROR_STOP=1 \
    -c "UPDATE users SET cognito_sub='${sub}' WHERE email='${email}';" >/dev/null
  echo "${sub}"
}

# Pool admin
# Superadmin: tenant_attr vacío → no se setea custom:tenant_id en el pool. El
# JwtAuthGuard usa `custom:role=admin_segurasist` como señal de cross-tenant.
ensure_user "${ADMIN_POOL_ID}" "${ADMIN_EMAIL}"                "admin_mac"        "${TENANT_ID}" "${ADMIN_PASSWORD}"
ensure_user "${ADMIN_POOL_ID}" "superadmin@segurasist.local"   "admin_segurasist" ""             "${DEMO_PASSWORD}"
ensure_user "${ADMIN_POOL_ID}" "operator@mac.local"            "operator"         "${TENANT_ID}" "${DEMO_PASSWORD}"
ensure_user "${ADMIN_POOL_ID}" "supervisor@mac.local"          "supervisor"       "${TENANT_ID}" "${DEMO_PASSWORD}"

# Pool insured (segregado para que un insured nunca pueda obtener un token con
# un rol admin, aun si los emails colisionan).
ensure_user "${INSURED_POOL_ID}" "insured.demo@mac.local"      "insured"          "${TENANT_ID}" "${DEMO_PASSWORD}"

# =========================================================================
# 4) Sincronizar cognito_sub real
# =========================================================================
ADMIN_SUB=$(sync_sub      "${ADMIN_POOL_ID}"   "${ADMIN_EMAIL}")
SUPER_SUB=$(sync_sub      "${ADMIN_POOL_ID}"   "superadmin@segurasist.local")
OPERATOR_SUB=$(sync_sub   "${ADMIN_POOL_ID}"   "operator@mac.local")
SUPERVISOR_SUB=$(sync_sub "${ADMIN_POOL_ID}"   "supervisor@mac.local")
INSURED_SUB=$(sync_sub    "${INSURED_POOL_ID}" "insured.demo@mac.local")

# =========================================================================
# 5) Resumen
# =========================================================================
echo ""
echo "[cognito-local-bootstrap] OK"
echo ""
printf "  %-34s  %-14s  %-18s  %-36s  %s\n" "USER" "POOL" "ROLE" "TENANT" "SUB"
printf "  %-34s  %-14s  %-18s  %-36s  %s\n" "----" "----" "----" "------" "---"
printf "  %-34s  %-14s  %-18s  %-36s  %s\n" "${ADMIN_EMAIL}"                "${POOL_ADMIN}"   "admin_mac"        "${TENANT_ID}" "${ADMIN_SUB}"
printf "  %-34s  %-14s  %-18s  %-36s  %s\n" "superadmin@segurasist.local"  "${POOL_ADMIN}"   "admin_segurasist" "<none>"       "${SUPER_SUB}"
printf "  %-34s  %-14s  %-18s  %-36s  %s\n" "operator@mac.local"           "${POOL_ADMIN}"   "operator"         "${TENANT_ID}" "${OPERATOR_SUB}"
printf "  %-34s  %-14s  %-18s  %-36s  %s\n" "supervisor@mac.local"         "${POOL_ADMIN}"   "supervisor"       "${TENANT_ID}" "${SUPERVISOR_SUB}"
printf "  %-34s  %-14s  %-18s  %-36s  %s\n" "insured.demo@mac.local"       "${POOL_INSURED}" "insured"          "${TENANT_ID}" "${INSURED_SUB}"
echo ""
echo "  Pega esto en segurasist-api/.env (sólo dev):"
echo "    COGNITO_REGION=local"
echo "    COGNITO_ENDPOINT=${COGNITO_ENDPOINT}"
echo "    COGNITO_USER_POOL_ID_ADMIN=${ADMIN_POOL_ID}"
echo "    COGNITO_USER_POOL_ID_INSURED=${INSURED_POOL_ID}"
echo "    COGNITO_CLIENT_ID_ADMIN=${ADMIN_CLIENT_ID}"
echo "    COGNITO_CLIENT_ID_INSURED=${INSURED_CLIENT_ID}"
echo ""
echo "  Passwords:"
echo "    ${ADMIN_EMAIL}                 → ${ADMIN_PASSWORD}"
echo "    *@segurasist.local / *@mac.local (resto) → ${DEMO_PASSWORD}"
