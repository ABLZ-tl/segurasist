# Credenciales de desarrollo (cognito-local + seed)

Este documento concentra las credenciales que se generan al correr la stack
local (`docker compose up -d`) más los seeds de Prisma y el bootstrap de
cognito-local. Todas las contraseñas listadas son **solo para entornos
locales** — los pools reales en AWS Cognito tienen passwords distintos
(SecretsManager + rotación trimestral).

## Bootstrap multi-tenant (Sprint 5 / CC-07)

A partir de Sprint 5, `cognito-local-bootstrap.sh` acepta dos flags para
crear usuarios en múltiples tenants en una sola corrida (necesario para los
E2E de portal multi-tenant y visual regression).

### Comandos

```bash
# 1) Stack arriba.
docker compose up -d

# 2) Seed Prisma — Sprint 1 (single-tenant 'mac').
cd segurasist-api
npx prisma migrate deploy
npx prisma db seed                          # genera tenant 'mac' + admin/insured demo

# 3) Seed Sprint 5 — agrega tenant 'demo-insurer' (idempotente).
npx tsx prisma/seed-multi-tenant.ts         # tenants: mac + demo-insurer

# 4) Bootstrap cognito-local en modo multi-tenant.
./scripts/cognito-local-bootstrap.sh --multi-tenant

#    O bien, lista explícita de slugs:
./scripts/cognito-local-bootstrap.sh --tenants mac,demo-insurer

#    Default (sin flags) — back-compat single-tenant 'mac':
./scripts/cognito-local-bootstrap.sh
```

### Usuarios generados (`--multi-tenant`)

| Email                              | Pool             | Rol                | Tenant         | Password                              |
|------------------------------------|------------------|--------------------|----------------|---------------------------------------|
| `superadmin@segurasist.local`      | `local_admin`    | `admin_segurasist` | (cross-tenant) | `Demo123!`                            |
| `admin@mac.local`                  | `local_admin`    | `admin_mac`        | `mac`          | `Admin123!`                           |
| `operator@mac.local`               | `local_admin`    | `operator`         | `mac`          | `Demo123!`                            |
| `supervisor@mac.local`             | `local_admin`    | `supervisor`       | `mac`          | `Demo123!`                            |
| `insured.demo@mac.local`           | `local_insured`  | `insured`          | `mac`          | `INSURED_DEFAULT_PASSWORD` (env) o `Insured-Sys-Auth-2026!@SecureLocal` |
| `admin@demo-insurer.local`         | `local_admin`    | `admin_mac`        | `demo-insurer` | `Demo123!`                            |
| `operator@demo-insurer.local`      | `local_admin`    | `operator`         | `demo-insurer` | `Demo123!`                            |
| `supervisor@demo-insurer.local`    | `local_admin`    | `supervisor`       | `demo-insurer` | `Demo123!`                            |
| `insured.demo@demo-insurer.local`  | `local_insured`  | `insured`          | `demo-insurer` | mismo que `insured.demo@mac.local`    |

Nota: el rol `admin_mac` en otros tenants es genérico — el guard usa
`custom:tenant_id` (no el slug del email) para resolver tenancy. El nombre
del rol `admin_mac` se mantiene por enum de Prisma; podría renombrarse a
`admin_tenant` en una migración futura (out-of-scope).

### Variables de entorno relevantes

```bash
COGNITO_ENDPOINT=http://localhost:9229
PGURL=postgresql://segurasist:segurasist@localhost:5432/segurasist
ADMIN_EMAIL=admin@mac.local            # solo afecta a mac (override del email canónico)
ADMIN_PASSWORD=Admin123!
DEMO_PASSWORD=Demo123!
INSURED_DEFAULT_PASSWORD=...           # debe coincidir con segurasist-api/.env
```

### Insureds seedeados (CURP)

| Tenant         | CURP                     | Nombre completo            |
|----------------|--------------------------|----------------------------|
| `mac`          | `HEGM860519MJCRRN08`     | María Hernández García     |
| `demo-insurer` | `LOPA900215HDFRRR07`     | Andrés López Ramírez       |

Estos CURP son los que consumen los specs E2E de Sprint 5
(`tests/e2e/multi-tenant-portal.spec.ts`,
`tests/visual-regression/portal-tenant-a.spec.ts`).

### Idempotencia

Tanto el seed Prisma como el bootstrap cognito-local son idempotentes:

- Seed: `upsert` por `tenants.slug`, `findFirst` + `create` por
  `(tenantId, email)`.
- Bootstrap: `admin-update-user-attributes` + `admin-set-user-password
  --permanent` cuando el usuario ya existe (no recrea el pool).

Re-correr `--multi-tenant` después de `--tenants mac` solo agrega los
usuarios faltantes para `demo-insurer`.

## Smoke-test

```bash
# Sanity: que el admin login emite token con el tenant correcto.
curl -X POST http://localhost:3000/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@demo-insurer.local","password":"Demo123!"}' \
  | jq '.idToken' \
  | cut -d'.' -f2 | base64 -d | jq '."custom:tenant_id"'
# → debe coincidir con el id del tenant 'demo-insurer' en la BD.
```
