# segurasist-api

API REST de SegurAsist — SaaS multi-tenant para administración de membresías de salud.
Stack: NestJS 10 + Fastify + TypeScript strict + Prisma 5 + PostgreSQL 16 + Redis 7. 100% AWS en runtime (App Runner + Lambda + RDS + Cognito + S3 + SES + SQS + KMS).

> Sprint 0: bootstrap. Los endpoints de negocio están en stub (`501 NOT_IMPLEMENTED`); sólo `/health/*`, `/v1/auth/*` y la matriz de seguridad están operativos.

## Requisitos

- Node.js **20 LTS** (`nvm use 20`)
- npm 10+ (también funciona con pnpm/yarn, pero el `package-lock` será npm)
- Docker + Docker Compose v2
- (Opcional) AWS CLI v2 si vas a probar contra LocalStack

## Setup local

```bash
# 1. Clonar e instalar
cd segurasist-api
npm install

# 2. Variables de entorno
cp .env.example .env
# Editar .env si quieres cambiar puertos / endpoints LocalStack

# 3. Levantar Postgres 16, Redis 7 y LocalStack (S3/SQS/KMS/SES)
docker compose up -d

# 4. Generar cliente Prisma + correr migraciones + seed
npx prisma generate
npx prisma migrate dev --name init
# (la migración 00000000000000_init_rls habilita RLS y crea los roles segurasist_app/segurasist_admin)
npm run prisma:seed

# 5. Arrancar el API en watch mode
npm run dev
# → http://localhost:3000/health/live
```

## Scripts npm relevantes

| Script | Descripción |
| --- | --- |
| `npm run dev` | Nest en watch mode (Fastify) |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm run start:prod` | Arranca `dist/main.js` con `NODE_ENV=production` |
| `npm run lint` | ESLint estricto (warnings = error) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:unit` | Jest — tests unitarios (`src/**/*.spec.ts`) |
| `npm run test:integration` | Jest — integración (Postgres real) |
| `npm run test:cross-tenant` | **GATE de PR** — aislamiento multi-tenant |
| `npm run test:e2e` | Jest — end-to-end |
| `npm run prisma:migrate` | `prisma migrate dev` |
| `npm run prisma:generate` | Regenera `@prisma/client` |
| `npm run prisma:seed` | Carga datos de seed |

## Tests

```bash
npm run test:unit          # rápido, sin DB
npm run test:integration   # requiere docker compose up -d
npm run test:cross-tenant  # GATE — debe pasar en cada PR
npm run test:e2e           # opcional, lento
```

## Estructura

```
src/
├── main.ts                     # bootstrap NestFactory + Fastify + helmet + cors
├── app.module.ts               # módulo raíz
├── config/                     # env schema (Zod) + ConfigModule
├── common/
│   ├── filters/                # HttpExceptionFilter (RFC 7807)
│   ├── interceptors/           # trace-id, audit, timeout
│   ├── guards/                 # jwt-auth, roles, throttle
│   ├── pipes/                  # zod-validation
│   ├── decorators/             # @CurrentUser, @Tenant, @Roles, @Scopes, @Public
│   └── prisma/                 # PrismaService request-scoped (RLS context)
├── modules/
│   ├── auth/ tenants/ users/ packages/ coverages/ insureds/
│   ├── batches/ certificates/ claims/ reports/ chat/ audit/ webhooks/
└── infra/
    ├── aws/                    # s3, sqs, ses, kms, cognito, secrets (SDK v3)
    ├── observability/          # pino logger, X-Ray, EMF metrics
    └── cache/                  # ioredis wrapper
prisma/
├── schema.prisma
└── migrations/
    └── 00000000000000_init_rls/migration.sql
test/
├── unit/  integration/  e2e/  security/
└── security/cross-tenant.spec.ts   # gate
```

## Multi-tenant

Cada tabla con datos de tenant lleva `tenant_id` NOT NULL. El aislamiento tiene **dos capas**:

1. **App**: `JwtAuthGuard` extrae `custom:tenant_id` del JWT Cognito; `PrismaService` (request-scoped) ejecuta `SET LOCAL app.current_tenant = '<uuid>'` antes de cada query y rechaza la petición si no hay tenant context.
2. **DB**: políticas RLS (`USING` + `WITH CHECK`) en cada tabla. El usuario `segurasist_app` no tiene `BYPASSRLS`. Sólo `segurasist_admin` (migraciones, MFA hard) puede saltarse RLS.

Ver `prisma/migrations/00000000000000_init_rls/migration.sql`.

## Errores

Todos los errores HTTP se devuelven en formato **RFC 7807 Problem Details** con campos `type`, `title`, `status`, `detail`, `instance`, `code`, `traceId` y opcionalmente `field`/`errors`. Catálogo en `src/common/error-codes.ts`.

## Despliegue

- Docker multi-stage (`Dockerfile`) → distroless `nodejs20-debian12`.
- AWS App Runner consume `apprunner.yaml`.
- CI/CD GitHub Actions (`.github/workflows/api-ci.yml`) con jobs `lint`, `test`, `security`, `build-image`, `deploy-staging`, `deploy-prod`. OIDC a AWS, sin claves estáticas.

## Documentación adicional

- `docs/adr/` — Architecture Decision Records.
- `docs/runbooks/` — runbooks operacionales.
- Spec completo: `../.extracted/MVP_04_Backend_NestJS_SegurAsist.txt`.
