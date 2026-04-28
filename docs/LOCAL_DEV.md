# SegurAsist — Desarrollo local (sin AWS)

Stack 100% local para Sprints 1–4. AWS real se introduce hasta Sprint 5 (provisioning + endurecimiento + DR + pentest).

## Prerrequisitos

| Herramienta | Versión |
|---|---|
| Docker Desktop | ≥ 24 |
| Node.js | 20.11.x |
| pnpm | ≥ 9 (web monorepo) |
| npm | ≥ 10 (api) |
| AWS CLI | ≥ 2.15 (para hablar con LocalStack) |

## Mapa de servicios locales

| Componente AWS | Reemplazo local | Endpoint |
|---|---|---|
| RDS PostgreSQL 16 | `postgres:16-alpine` | `localhost:5432` |
| ElastiCache Redis | `redis:7-alpine` | `localhost:6379` |
| S3 / KMS / SQS / Secrets | LocalStack | `localhost:4566` |
| Cognito User Pool | cognito-local | `localhost:9229` |
| SES (email transaccional) | Mailpit (SMTP + Web UI) | SMTP `localhost:1025`, UI `localhost:8025` |
| App Runner (api) | `npm run dev` | `localhost:3000` |
| Amplify Hosting (admin) | `pnpm --filter admin dev` | `localhost:3001` |
| Amplify Hosting (portal) | `pnpm --filter portal dev` | `localhost:3002` |
| CloudWatch Logs | stdout (pino-pretty) | terminal |

## Boot sequence

```bash
# 1. Backend infra
cd segurasist-api
docker compose up -d
docker compose ps        # todos healthy

# 2. Bootstrap recursos AWS-emulados (LocalStack)
./scripts/localstack-bootstrap.sh   # crea buckets, colas, KMS key (TODO Sprint 1)

# 3. Bootstrap Cognito local
./scripts/cognito-local-bootstrap.sh  # crea user pools + clients (TODO Sprint 1)

# 4. DB
npm install
npx prisma migrate deploy                    # aplica `20260425_init_schema/migration.sql` (baseline pre-generado)
./scripts/apply-rls.sh                       # crea roles segurasist_app/_admin + RLS + extensión pg_trgm
npx prisma db seed                           # tenant `mac` + admin user de seed

# 5. API
npm run dev              # http://localhost:3000

# 6. Web (en otra terminal)
cd ../segurasist-web
pnpm install
pnpm --filter admin dev  # http://localhost:3001
pnpm --filter portal dev # http://localhost:3002
```

## Overrides en `.env` (api)

Copia `.env.example` a `.env` y aplica estos overrides para el modo local:

```bash
# Habilitar endpoint LocalStack para todos los SDK clients de AWS
AWS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# Cognito apuntando a cognito-local. La presencia de COGNITO_ENDPOINT
# hace que JwtAuthGuard arme issuer/JWKS contra cognito-local en lugar de
# `https://cognito-idp.<region>.amazonaws.com`. Ausente en prod.
COGNITO_REGION=local
# IMPORTANT: usar 0.0.0.0 (no localhost) — cognito-local emite el `iss` claim
# como `http://0.0.0.0:9229/<poolId>`. Si pones `localhost`, JwtAuthGuard rechaza
# el JWT con "unexpected iss claim value".
COGNITO_ENDPOINT=http://0.0.0.0:9229
COGNITO_USER_POOL_ID_ADMIN=local_admin
COGNITO_USER_POOL_ID_INSURED=local_insured
COGNITO_CLIENT_ID_ADMIN=local-admin-client
COGNITO_CLIENT_ID_INSURED=local-insured-client

# Email vía Mailpit (SMTP en lugar de SES API)
EMAIL_TRANSPORT=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
SES_SENDER_DOMAIN=segurasist.local

# CORS para los dos frontends locales
CORS_ALLOWED_ORIGINS=http://localhost:3001,http://localhost:3002
```

## Ver emails

Mailpit captura todo lo que la API envíe a `localhost:1025`. Abre http://localhost:8025 — bandeja, vista HTML, headers, search. Cero spam, cero credenciales.

## Login local (admin)

Cognito-local emula `InitiateAuth` y firma JWTs reales (RS256, JWKS publicado). El módulo de auth de NestJS valida contra `COGNITO_ENDPOINT` en lugar de `cognito-idp.<region>.amazonaws.com`.

Usuario semilla (creado por `cognito-local-bootstrap.sh`, email alineado con `prisma/seed.ts`):
- email: `admin@mac.local`
- password: `Admin123!`
- pool: `local_admin`
- `custom:tenant_id`: el id del tenant `mac` que produce el seed (el script lo lee de Postgres y sincroniza `users.cognito_sub` con el sub real generado por cognito-local).

Para portal asegurado (Sprint 3) los OTPs aparecen en consola de cognito-local y en Mailpit.

### C-04 — `INSURED_DEFAULT_PASSWORD` blocklist

A partir de Sprint 4 (audit C-04), el env validator rechaza valores de
`INSURED_DEFAULT_PASSWORD` que estén en una blocklist de passwords débiles
conocidos (e.g. `Demo123!`, `Password1!`, `admin`). El check corre **también
en dev**, no solo en prod.

`cognito-local-bootstrap.sh` toma el valor del `.env` (si está exportado al
shell) y lo aplica como password del usuario `insured.demo` para que la API
pueda autenticarse después del OTP. Si modificas el valor:

1. Edita `INSURED_DEFAULT_PASSWORD` en `.env` (≥14 chars, símbolos, fuera de
   la blocklist — `Insured-Sys-Auth-2026!@SecureLocal` cumple).
2. Re-corre `./scripts/cognito-local-bootstrap.sh` para que sincronice
   cognito-local con el nuevo valor.
3. Reinicia `npm run dev`.

El default que provee `.env.example` (`DevLocal-PleaseChange-9!`) ya pasa el
validator y funciona out-of-the-box con `./scripts/local-up.sh`.

## Diferencias deliberadas vs producción

| Punto | Local | Producción | Mitigación |
|---|---|---|---|
| MFA | TOTP opcional | TOTP obligatorio (admins) + SAML Azure AD MAC | Smoke tests SAML en Sprint 5 contra Cognito real |
| Object Lock S3 | LocalStack lo simula sin garantía real de inmutabilidad | COMPLIANCE mode, retención 7 años | Pentest Sprint 5 valida en staging |
| KMS | LocalStack key id arbitrario | CMK con rotación 365 d, alias `alias/segurasist-prod-*` | Terraform Sprint 5 |
| Email reputation | n/a (Mailpit) | SES out-of-sandbox + DKIM + SPF + DMARC | AWS-002 (Sprint 5 gate) |
| WAF / GuardDuty | no | sí | Terraform + controles V2 (Sprint 5) |

## Reset rápido

```bash
docker compose down -v   # destruye volúmenes (postgres, localstack, cognito-local)
docker compose up -d
npx prisma migrate reset --force --skip-seed   # reaplica todas las migraciones
./scripts/apply-rls.sh                          # vuelve a aplicar policies (idempotente)
npx prisma db seed
```

## Orden de migraciones — por qué dos pasos

`prisma/migrations/` contiene SÓLO las migraciones de schema generadas por
Prisma (la primera, `20260425_init_schema/migration.sql`, viene
pre-generada por `prisma migrate diff --from-empty`). El bootstrap RLS
(`prisma/rls/policies.sql`) corre APARTE porque:

1. Las políticas `ALTER TABLE … ENABLE RLS` requieren que las tablas existan,
   y un script manual antes de Prisma fallaría por tablas inexistentes.
2. El bootstrap necesita superuser para `CREATE ROLE`; el rol de aplicación
   no debería poder ejecutarlo.
3. `prisma migrate deploy` en prod lo lanza el job de pre-deploy (con un
   secret de superuser) ANTES de poner el servicio en tráfico.

`./scripts/apply-rls.sh` es idempotente: drop policy if exists + create.
Reaplicarlo es seguro tras cualquier `prisma migrate deploy`.

Para añadir cambios al schema:

```bash
# 1) editar prisma/schema.prisma
# 2) generar la nueva migración
npx prisma migrate dev --name <descripción>
# 3) reaplicar RLS (idempotente)
./scripts/apply-rls.sh
```

## Test cross-tenant

```bash
# Requiere postgres up + migrate + apply-rls.sh + seed.
npm run test:cross-tenant
```

El test conecta como `segurasist_admin` (BYPASSRLS) para sembrar 2 tenants y
luego como `segurasist_app` (NOBYPASSRLS) para verificar:

- sin `SET LOCAL app.current_tenant` → 0 filas
- con tenant A → solo ve insureds de A
- buscar insured de B con context A → null
- INSERT con tenant_id=B y context=A → falla por `WITH CHECK`

Si los roles no existen aún (`apply-rls.sh` no corrió), el test se salta con
warning en lugar de fallar.

## Troubleshooting

- **`pg_isready` falla**: el contenedor `segurasist-postgres` aún arrancando, espera 5 s.
- **`AccessDenied` en S3**: olvidaste `AWS_ENDPOINT_URL=http://localhost:4566` en `.env`.
- **Cognito JWT inválido**: cognito-local cambia el JWKS al recrear el contenedor; reinicia la api para refrescar el cache.
- **Mailpit no recibe**: `SMTP_HOST` debe ser `localhost` (no `mailpit`) si la api corre fuera de Docker; si la api corre en compose, usa el nombre del servicio.
