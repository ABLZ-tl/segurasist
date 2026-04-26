# ADR-0001 — Stack inicial del repo `segurasist-api`

- Status: Aceptado
- Fecha: 2026-04-25
- Decisores: Tech Lead, Backend Senior, DevOps Lead

## Contexto

Este ADR consolida en el repositorio `segurasist-api` las decisiones cerradas en el documento *MVP_03_Arquitectura_SegurAsist* (sección 7). Se incluyen aquí como referencia para que cualquier nuevo desarrollador entienda el “porqué” del stack sin tener que leer los nueve documentos de la suite MVP.

## Decisiones heredadas (resumen)

| ADR | Decisión | Implicación para este repo |
| --- | --- | --- |
| ADR-001 | 100% AWS, región primaria `mx-central-1`, DR en `us-east-1`. | SDK AWS v3, sin abstracciones cloud-agnostic. |
| ADR-002 | App Runner para el backend NestJS (1 vCPU / 2 GB). | `Dockerfile` multi-stage + `apprunner.yaml`. Sin orquestador. |
| ADR-003 | RDS PostgreSQL 16 Multi-AZ (db.t4g.small) con pgAudit. | `prisma/schema.prisma` con `provider = postgresql`. RLS habilitado. |
| ADR-004 | Cognito (User Pool admin + User Pool insured). | `JwtAuthGuard` valida ambos issuers. |
| ADR-005 | SQS + Lambda para jobs asíncronos; ElastiCache Redis Serverless sólo para sesión, OTP, throttle. | `src/infra/aws/sqs.service.ts` + `src/infra/cache/redis.service.ts`. |
| ADR-006 | Frontend Next.js 14 en Amplify Hosting (otro repo). | Sólo afecta CORS aquí. |
| ADR-007 | Aislamiento multi-tenant con `tenant_id` + RLS PostgreSQL como segunda capa. | `PrismaService` REQUEST-scoped fija `app.current_tenant`; `migration.sql` crea políticas. |
| ADR-008 | Observabilidad CloudWatch + X-Ray (sin Datadog en MVP). | `pino` JSON estructurado + EMF helpers + X-Ray init stub. |
| ADR-009 | PDFs con Puppeteer en Lambda (no en App Runner). | El API sólo encola `certificate.issued`; no carga Chromium. |
| ADR-010 | Two-pool Cognito (admin vs insured). | `COGNITO_USER_POOL_ID_ADMIN` y `COGNITO_USER_POOL_ID_INSURED` en env. |
| ADR-011 | IaC obligatorio Terraform en repo `segurasist-infra`. | Cero recursos productivos creados desde este repo. |
| ADR-012 | Monorepo Next.js para admin + portal asegurado. | El backend expone una sola API REST `/v1/*`. |
| ADR-013 | Auditoría con S3 Object Lock Compliance, retención 24 m. | El API solo escribe en `audit_log`; CloudWatch → S3 lo gestiona Terraform. |

## Decisiones específicas de este repo

1. **Fastify** (no Express). Throughput ~2× en handlers ligeros, schema validation nativo, footprint menor en Lambda containers (futuro).
2. **TypeScript strict + `noUncheckedIndexedAccess`**. Path aliases `@common/*`, `@modules/*`, `@infra/*`, `@config/*` en `tsconfig.json` y `jest.config.ts`.
3. **Validación con Zod**, no `class-validator`. Schemas viven al lado de los DTOs de cada módulo.
4. **Errores RFC 7807**. Catálogo central en `src/common/error-codes.ts`.
5. **`PrismaService` request-scoped**. `Scope.REQUEST` permite atar el `tenant_id` del JWT al `SET LOCAL app.current_tenant` por petición. Sí: tiene un coste de ~0.3 ms por request por crear el cliente; aceptable para el SLA.
6. **Errors `NOT_IMPLEMENTED`** durante Sprint 0. Cada service stub lanza `NotImplementedException` con código `NOT_IMPLEMENTED` (HTTP 501). El gate de cross-tenant test usa `it.todo` para no comentar, pero mantener visible la matriz.

## Consecuencias

- Cualquier feature backend nueva entra como módulo Nest con `controller + service + module + dto/*.ts (Zod)`. Tests `*.spec.ts` al lado del código (unit) y en `test/integration/` (con Postgres real).
- El gate `npm run test:cross-tenant` se ejecuta en CI y bloquea merge si encuentra fugas.
- Migraciones Prisma versionadas en `prisma/migrations/`; la migración `00000000000000_init_rls` se reaplica idempotentemente.

## Referencias

- `MVP_03_Arquitectura_SegurAsist.txt` (§7 ADRs)
- `MVP_04_Backend_NestJS_SegurAsist.txt`
- `MVP_06_DevOps_IaC_SegurAsist.txt`
- `MVP_08_Seguridad_Cumplimiento_SegurAsist.txt`
