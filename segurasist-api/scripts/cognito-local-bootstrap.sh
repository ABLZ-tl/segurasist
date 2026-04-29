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
#   ./scripts/cognito-local-bootstrap.sh --multi-tenant
#   ./scripts/cognito-local-bootstrap.sh --tenants mac,demo-insurer
#
# Sprint 5 / CC-07:
#   --multi-tenant        Bootstrap usuarios para los 2 tenants del seed
#                         multi-tenant (mac + demo-insurer). Equivale a
#                         `--tenants mac,demo-insurer`.
#   --tenants A,B[,C...]  Lista CSV de slugs de tenants para los cuales
#                         crear admin + insured (los slugs deben existir en
#                         BD; ejecuta `npx prisma db seed` o el seed
#                         multi-tenant antes).
#
# Default (sin flags): single-tenant — solo registra usuarios para el
# tenant slug='mac' (back-compat con seed.ts del Sprint 1).
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

# =========================================================================
# Flag parsing — Sprint 5 / CC-07 multi-tenant bootstrap
# =========================================================================
# TENANT_SLUGS: lista (array bash) de slugs a bootstrappear. Default = ('mac').
TENANT_SLUGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --multi-tenant)
      TENANT_SLUGS=("mac" "demo-insurer")
      shift
      ;;
    --tenants)
      if [[ -z "${2:-}" ]]; then
        echo "[cognito-local-bootstrap] FATAL: --tenants requiere lista CSV (e.g. --tenants mac,demo-insurer)" >&2
        exit 64
      fi
      IFS=',' read -r -a TENANT_SLUGS <<< "$2"
      shift 2
      ;;
    --tenants=*)
      IFS=',' read -r -a TENANT_SLUGS <<< "${1#--tenants=}"
      shift
      ;;
    -h|--help)
      sed -n '1,40p' "$0"
      exit 0
      ;;
    *)
      echo "[cognito-local-bootstrap] FATAL: flag desconocida '$1'" >&2
      echo "  uso: $0 [--multi-tenant | --tenants slug1,slug2,...]" >&2
      exit 64
      ;;
  esac
done
if [[ ${#TENANT_SLUGS[@]} -eq 0 ]]; then
  TENANT_SLUGS=("mac")  # back-compat: comportamiento original sin flag.
fi

COGNITO_ENDPOINT="${COGNITO_ENDPOINT:-http://localhost:9229}"
AWS_REGION="${AWS_REGION:-local}"
PGURL="${PGURL:-postgresql://segurasist:segurasist@localhost:5432/segurasist}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@mac.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin123!}"
DEMO_PASSWORD="${DEMO_PASSWORD:-Demo123!}"

# C-04 — INSURED_DEFAULT_PASSWORD vive en .env y la API lo usa después de
# OTP para emitir tokens contra el pool insured. El env validator (Zod
# superRefine) bloquea valores en blocklist (e.g. "Demo123!"). Por eso el
# password del usuario insured se setea por separado: si .env lo define
# (carga vía `set -a; source .env; set +a` antes de correr este script o
# pasándolo explícito), lo usamos; si no, fallback a un default fuerte que
# pasa el validator.
INSURED_SYS_PASSWORD="${INSURED_DEFAULT_PASSWORD:-Insured-Sys-Auth-2026!@SecureLocal}"
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
# 1) Recuperar tenant_id de cada slug solicitado (slug → id)
# =========================================================================
# Usamos arrays paralelos: TENANT_IDS[i] mapea a TENANT_SLUGS[i]. Bash no
# soporta dicts portables en versiones <4 (macOS), así que mantenemos el
# patrón paralelo por compatibilidad.
TENANT_IDS=()
for slug in "${TENANT_SLUGS[@]}"; do
  tid=$(psql "${PGURL}" -tAc "SELECT id FROM tenants WHERE slug='${slug}' LIMIT 1;" 2>/dev/null | tr -d '[:space:]' || true)
  if [[ -z "${tid}" ]]; then
    echo "[cognito-local-bootstrap] FATAL: no encuentro tenant slug='${slug}' en la BD." >&2
    echo "  Para '--multi-tenant' corre antes: 'npx prisma db seed' (mac) y" >&2
    echo "  'npx tsx prisma/seed-multi-tenant.ts' (mac + demo-insurer)." >&2
    exit 3
  fi
  TENANT_IDS+=("${tid}")
  echo "[tenant] ${slug} → ${tid}"
done

# Mantener TENANT_ID = primer tenant para back-compat con el resumen final
# y los logs single-tenant del summary block.
TENANT_ID="${TENANT_IDS[0]}"

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
  # H-27 — given_name / family_name opcionales para que el portal asegurado
  # muestre la identidad real ("Hola, María") en lugar del fallback derivado
  # del email ("insured.demo"). El JWT idToken propaga estos claims si el
  # schema del pool los acepta (los pools cognito-local del bootstrap no
  # exigen schema explícito para given_name/family_name — ambos son
  # standard attributes del directorio Cognito).
  local given_name="${6:-}"
  local family_name="${7:-}"

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
  # H-27 — propagamos given_name/family_name SOLO si el caller los pasó
  # (admin/operator/supervisor no los necesitan; el portal del insured sí).
  if [[ -n "${given_name}" ]]; then
    attrs_create+=("Name=given_name,Value=${given_name}")
    attrs_update+=("Name=given_name,Value=${given_name}")
  fi
  if [[ -n "${family_name}" ]]; then
    attrs_create+=("Name=family_name,Value=${family_name}")
    attrs_update+=("Name=family_name,Value=${family_name}")
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

# Pool admin — superadmin único (no tenant-scoped). Solo se crea una vez,
# no se itera por tenant. tenant_attr vacío → no se setea custom:tenant_id en
# el pool. El JwtAuthGuard usa `custom:role=admin_segurasist` como señal de
# cross-tenant.
ensure_user "${ADMIN_POOL_ID}" "superadmin@segurasist.local"   "admin_segurasist" ""             "${DEMO_PASSWORD}"
SUPER_SUB=$(sync_sub      "${ADMIN_POOL_ID}"   "superadmin@segurasist.local")

# Sprint 5 / CC-07 — bootstrap admin + insured per slug solicitado.
# Para cada tenant en TENANT_SLUGS[i] / TENANT_IDS[i]:
#   - admin@<slug>.local / supervisor@<slug>.local / operator@<slug>.local
#     (admin_mac/supervisor/operator role)
#   - insured.demo@<slug>.local (insured role, pool insured separado)
#
# Excepción back-compat (tenant 'mac'): conservamos los emails canónicos de
# Sprint 1 (admin@mac.local, ADMIN_PASSWORD distinto del DEMO_PASSWORD,
# given_name=María/Hernández para el insured demo). Cualquier otro slug usa
# DEMO_PASSWORD para el admin.
declare -a SUMMARY_ROWS=()
SUMMARY_ROWS+=("$(printf "  %-34s  %-14s  %-18s  %-36s  %s" "superadmin@segurasist.local" "${POOL_ADMIN}" "admin_segurasist" "<none>" "${SUPER_SUB}")")

for i in "${!TENANT_SLUGS[@]}"; do
  slug="${TENANT_SLUGS[$i]}"
  tid="${TENANT_IDS[$i]}"

  if [[ "${slug}" == "mac" ]]; then
    admin_email="${ADMIN_EMAIL}"        # admin@mac.local (override)
    admin_password="${ADMIN_PASSWORD}"
    insured_given="María"
    insured_family="Hernández"
  else
    admin_email="admin@${slug}.local"
    admin_password="${DEMO_PASSWORD}"
    insured_given=""
    insured_family=""
  fi
  operator_email="operator@${slug}.local"
  supervisor_email="supervisor@${slug}.local"
  insured_email="insured.demo@${slug}.local"

  echo "[bootstrap] tenant='${slug}' id=${tid}"
  ensure_user "${ADMIN_POOL_ID}"   "${admin_email}"      "admin_mac"  "${tid}" "${admin_password}"
  ensure_user "${ADMIN_POOL_ID}"   "${operator_email}"   "operator"   "${tid}" "${DEMO_PASSWORD}"
  ensure_user "${ADMIN_POOL_ID}"   "${supervisor_email}" "supervisor" "${tid}" "${DEMO_PASSWORD}"
  ensure_user "${INSURED_POOL_ID}" "${insured_email}"    "insured"    "${tid}" "${INSURED_SYS_PASSWORD}" "${insured_given}" "${insured_family}"

  # Sync subs.
  admin_sub=$(sync_sub      "${ADMIN_POOL_ID}"   "${admin_email}")
  operator_sub=$(sync_sub   "${ADMIN_POOL_ID}"   "${operator_email}")
  supervisor_sub=$(sync_sub "${ADMIN_POOL_ID}"   "${supervisor_email}")
  insured_sub=$(sync_sub    "${INSURED_POOL_ID}" "${insured_email}")

  SUMMARY_ROWS+=("$(printf "  %-34s  %-14s  %-18s  %-36s  %s" "${admin_email}"      "${POOL_ADMIN}"   "admin_mac"  "${tid}" "${admin_sub}")")
  SUMMARY_ROWS+=("$(printf "  %-34s  %-14s  %-18s  %-36s  %s" "${operator_email}"   "${POOL_ADMIN}"   "operator"   "${tid}" "${operator_sub}")")
  SUMMARY_ROWS+=("$(printf "  %-34s  %-14s  %-18s  %-36s  %s" "${supervisor_email}" "${POOL_ADMIN}"   "supervisor" "${tid}" "${supervisor_sub}")")
  SUMMARY_ROWS+=("$(printf "  %-34s  %-14s  %-18s  %-36s  %s" "${insured_email}"    "${POOL_INSURED}" "insured"    "${tid}" "${insured_sub}")")

  # Back-compat: para el tenant primario (mac, idx 0), populate los
  # antiguos *_SUB scalars usados por el cliente del summary block.
  if [[ "${i}" -eq 0 ]]; then
    ADMIN_SUB="${admin_sub}"
    OPERATOR_SUB="${operator_sub}"
    SUPERVISOR_SUB="${supervisor_sub}"
    INSURED_SUB="${insured_sub}"
  fi
done

# =========================================================================
# 5) Resumen
# =========================================================================
echo ""
echo "[cognito-local-bootstrap] OK (tenants: ${TENANT_SLUGS[*]})"
echo ""
printf "  %-34s  %-14s  %-18s  %-36s  %s\n" "USER" "POOL" "ROLE" "TENANT" "SUB"
printf "  %-34s  %-14s  %-18s  %-36s  %s\n" "----" "----" "----" "------" "---"
for row in "${SUMMARY_ROWS[@]}"; do
  echo "${row}"
done
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
echo "    admin@mac.local                                    → ${ADMIN_PASSWORD}"
echo "    admin@<otro-slug>.local / operator@*/supervisor@*  → ${DEMO_PASSWORD}"
echo "    superadmin@segurasist.local                        → ${DEMO_PASSWORD}"
echo "    insured.demo@<slug>.local                          → ${INSURED_SYS_PASSWORD}"
