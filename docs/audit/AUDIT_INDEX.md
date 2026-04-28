# 🎯 AUDIT INDEX — Reporte Ejecutivo Final

> **Fuente**: 20 reportes individuales (10 áreas × 2 vueltas) + bitácora compartida `_findings-feed.md` (96 entradas) + auditorías independientes de seguridad y QA.
>
> **Commit auditado**: `a8af110` (Sprint 3 closure).
>
> **Generado**: 2026-04-27 post-Sprint 3.
>
> **Propósito**: dispatch paralelo de sub-agentes de fixes con prompts específicos. Cada bundle es disjoint (sin colisión de archivos) para que los fixes corran en paralelo sin race conditions.

---

## 1. Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Total findings | **~141** |
| 🔴 Critical (bloquean Go-Live) | **15** |
| 🟠 High | **57+** |
| 🟡 Medium | **42+** |
| 🟢 Low | **27+** |
| Patrones sistémicos (≥3 agentes) | **7** |
| Cross-cutting feed entries | **96 líneas** |
| Tests automatizados verdes hoy | 1,094 |
| Tests con falsa cobertura (coverage façade) | A7v2-02, A1-01, A5-03 |
| Compliance V2 (matriz 33 controles) | 89.4% — APTO con remediation Sprint 4 |
| Compliance audit Sprint 1 (13 items) | 96% |

**Estado overall**: el sistema tiene **arquitectura sólida** (RLS multi-tenant, defense-in-depth, hash chain audit, mirror Object Lock) pero **15 Critical bugs** funcionales y de seguridad bloquean Go-Live. Los fixes están **mayormente en archivos disjoint** — pueden aplicarse en paralelo con dispatch coordinado.

---

## 2. Tabla maestra Critical (15) — Prioridad P0 (pre-Go-Live obligatoria)

| ID | File:line | SEV | Categoría | Descripción | Fix | Tests requeridos | Deps con otros fixes | Effort | Bundle |
|---|---|---|---|---|---|---|---|---|---|
| **C-01** | `pdf-worker.service.ts:316,357` | 🔴 | Integridad | `Certificate.hash` y `qrPayload` usan `provisionalHash` random; SHA real solo en S3 metadata | Re-render 2-pass: render → SHA del buffer → upload con metadata + persist hash real en BD | `cert-integrity.spec.ts` recomputa SHA del buffer Puppeteer y compara con `Certificate.hash`. Test inmutabilidad post-issue | C-13 (CSP frame-src) hace que el bug sea visible en preview iframe | 4-6h | **B-PDF** |
| **C-02** | `apps/portal/app/api/proxy/[...path]/route.ts:2,13` | 🔴 | Wiring/CSRF | Importa `SESSION_COOKIE` admin (`sa_session`) en vez de `PORTAL_SESSION_COOKIE` (`sa_session_portal`) | Cambiar import a `lib/cookie-names.ts` `PORTAL_SESSION_COOKIE`. **1 LOC** | `proxy.spec.ts` verifica que `Authorization: Bearer` se forwarda con cookie portal correcta | C-04 (cognito_sub no persiste) aparece como regresión al cerrar este | 30min + tests 2h | **B-PORTAL-AUTH** |
| **C-03** | `auth.service.ts:300-326` | 🔴 | Wiring | `otpVerify` consigue tokens Cognito pero NO persiste `insureds.cognito_sub`. Todos los `findFirst({where:{cognitoSub: user.cognitoSub}})` devuelven 404 al cerrar C-02 | En `verifyInsuredOtp` post-success: `prisma.insured.update({where:{tenantId, curp}, data:{cognitoSub: claims.sub}})` | `otp-flow.integration.spec.ts` con stack docker+Mailpit verifica cognito_sub persiste tras verify | **C-02** debe estar fixed primero o ambos ir en mismo PR | 2h + tests 3h | **B-PORTAL-AUTH** |
| **C-04** | `env.schema.ts:154` | 🔴 | Seguridad | `INSURED_DEFAULT_PASSWORD` default literal `'Demo123!'`. NO en `.env.example` NI `superRefine` que lo bloquee en prod → bypass directo OTP via `AdminInitiateAuth` | Eliminar default. Agregar `superRefine` que rechaza valor `Demo123!` o cualquier hardcoded en `NODE_ENV=production` | `env.schema.spec.ts`: `prod + INSURED_DEFAULT_PASSWORD=Demo123!` → throws | Independiente | 30min + tests 1h | **B-AUTH-SEC** |
| **C-05** | `layout-worker.service.ts:137-140` | 🔴 | Funcional | Path async corre `findIntraFileDuplicates` DENTRO de chunks de 500 filas → CURPs duplicadas entre fila 5 y fila 700 NO se marcan `DUPLICATED_IN_FILE` | Pre-computar `findIntraFileDuplicates` ANTES del loop de chunks, pasar Set<curp> al validador | `batches-flow.spec.ts` con fixture 1k filas + 10 duplicates separados >500 rows → todos marcados | Independiente | 3h + tests 2h | **B-BATCHES** |
| **C-06** | `batches.service.ts:447-450` + `insureds-creation-worker.service.ts:200-218` | 🔴 | Funcional | `confirm()` deja `rowsOk/rowsError` con counts validación; worker incrementa encima → `rowsOk+rowsError >= rowsTotal` se cumple tras PRIMERA creación → batch `completed` prematuro | Resetear contadores en `confirm()` a 0; o agregar columnas `processedRows/successRows/failedRows` separadas en migración | `confirm-flow.integration.spec.ts` con 100 filas válidas → batch sigue `processing` hasta procesarse las 100 | Cierra C-07 (TOCTOU) parcial | 4h + tests 3h | **B-BATCHES** |
| **C-07** | `bumpBatchCounters` (mismo file C-06) | 🔴 | Concurrencia | TOCTOU + `batch.completed` `dedupeId` ignorado en cola standard → doble emisión que A4 PDF worker consume → **2 PDFs por insured** | Atomic `UPDATE batches SET ... RETURNING` + idempotencia DB-side con `UNIQUE (batch_id, status='completed')` constraint | `batch-completed-once.integration.spec.ts` simula carrera con 2 workers concurrentes → solo 1 emit | C-06 + C-09 (FIFO/UNIQUE) | 4h + tests 3h | **B-BATCHES** |
| **C-08** | `confirm()` con `rowsToInclude` subset | 🔴 | Funcional | Comparación contra `rowsTotal` no `queuedCount` → batch nunca completa subset → `processing` infinito sin TTL | `confirm()` setear `queuedCount` y comparar contra ese; o TTL en estado processing | Test con `rowsToInclude=[1,2,3]` de 100 → `completed` cuando los 3 procesados | C-06 | 3h + tests 2h | **B-BATCHES** |
| **C-09** | `infra/aws/sqs.service.ts:20-26` + `localstack-bootstrap.sh` + `Terraform sqs-queue/` | 🔴 | Operacional | `MessageDeduplicationId` enviado a colas standard → SQS lo ignora silently (LocalStack tolera, AWS real rechaza con `InvalidParameterValue`) — bug operacional #1 (5 agentes confirman) | **Decisión arquitectónica**: eliminar `dedupeId` de `SqsService.sendMessage()` y mover idempotencia a DB con UNIQUE constraints en `exports`/`batches`/`insureds` (tenant_id, key) | `sqs-dedup-removal.spec.ts` valida que sendMessage SIN dedupeId funciona en standard queue | Independiente del code, pero correlaciona con C-07 | 3h + tests 2h | **B-INFRA-SQS** |
| **C-10** | `audit-chain-verifier.service.ts:140-153` | 🔴 | Integridad | `recomputeChainOkFromDb` (path `source='both'`) solo encadena `prev_hash` sin recomputar SHA → tampering coordinado con BYPASSRLS pasa silencioso si fila no mirroreada | Exportar `runVerification` desde `audit-writer.service.ts:381` y usarlo en lugar del light path. Combinado con C-01 cierra integridad end-to-end | `audit-tampering.integration.spec.ts` UPDATE coordinated `payloadDiff+rowHash` consistente entre sí → discrepancy detectada | C-01 (mismo dominio integridad) | 3h + tests 4h | **B-AUDIT** |
| **C-11** | `packages/auth/src/middleware.ts:64` + `packages/auth/src/session.ts` | 🔴 | CSRF | `protectMiddleware` ejecuta `setSessionCookies` (legacy `lax`) en CADA silent refresh. Toda sesión admin >15min en prod queda con `sameSite='lax'` SIN pasar por callback Cognito | Refactor `packages/auth/src/session.ts` a `sameSite='strict'`. Crear `packages/security/cookie.ts` factory consolidado | `silent-refresh.spec.ts` verifica que cookies post-refresh tienen `SameSite=Strict` | Cierra A7-01, A7-02 (logout GET), C-02, H-02 | 4h + tests 3h | **B-COOKIES-DRY** |
| **C-12** | `.github/workflows/ci.yml:367` + `segurasist-api/src/main.ts` | 🔴 | CI/CD | `SwaggerModule` jamás wireado → `/v1/openapi.json` 404 → DAST job fallará al desbloquear OIDC | En `main.ts`: `SwaggerModule.setup('v1/openapi', app, document, { ... })`. Documento generado de DTOs Zod | CI YAML lint + smoke local `curl :3000/v1/openapi.json` → 200 | C-13, C-14 (mismo bundle CI) | 2h + 1h | **B-CI** |
| **C-13** | `segurasist-infra/global/iam-github-oidc/main.tf` | 🔴 | CI/CD | `tf_plan_{staging,prod}` IAM roles NO existen — `terraform-plan.yml:99` referencia los 3 envs | Agregar 2 roles `aws_iam_role.tf_plan_{staging,prod}` con trust policy condicionada a `repo:.../segurasist-infra:ref:refs/heads/main` y permissions `terraform-plan-readonly` | `terraform validate` global + check OIDC trust con `aws iam get-role` | C-12 (mismo bundle) | 2h + 1h | **B-CI** |
| **C-14** | `segurasist-infra/envs/{dev,staging,prod}/` | 🔴 | Observabilidad | `cloudwatch-alarm` módulo bien diseñado pero NO invocado en ningún env → on-call ciego en prod | Crear `envs/{env}/alarms.tf` con SNS topic + 7-10 alarmas core: API down, RDS CPU, SQS DLQ, WAF blocked, SES bounce rate, AuditWriter degraded, Mirror lag | `terraform plan` outputs todas las alarmas. Smoke local: trigger fake event → SNS receives | Independiente | 6h + 2h | **B-OBSERVABILITY** |
| **C-15** | `segurasist-api/prisma/migrations/20260427_add_exports_table/` + `policies.sql` | 🔴 | Multi-tenant | Tabla `exports` policies SOLO en migración, NO en `policies.sql` — `apply-rls.sh` re-aplicación contra DB nueva omite RLS para `exports` (drift confirmado por A2 + B9) | Agregar `exports` al array de tablas en `policies.sql` con `FOR ALL USING (tenant_id...) WITH CHECK (...)`. Verificar idempotencia post-migración | `apply-rls-idempotency.integration.spec.ts` borra DB → migrate → apply-rls → verifica policy en `exports` | Independiente | 1h + tests 1h | **B-RLS** |

---

## 3. Tabla maestra High (top 30 priorizados — Sprint 4)

| ID | File:line | SEV | Categoría | Descripción resumida | Bundle |
|---|---|---|---|---|---|
| H-01 | `auth.service.ts:233,318` + `audit.interceptor.ts:11-30` + `scrub-sensitive.ts:23-38` | 🟠 | Audit infra | `AuditAction` enum overloaded por OTP/download/view; `SENSITIVE_KEYS` listas duplicadas con depths distintas (8 vs 12) → **refactor a `AuditContextFactory`** cierra 5 findings | **B-AUDIT** |
| H-02 | `audit.controller.ts:63-77` | 🟠 | Performance/DoS | `GET /v1/audit/verify-chain` SIN throttle. Operación cara (full table scan + ListObjectsV2 + GetObject NDJSON) → DoS por superadmin con creds comprometidas | **B-AUDIT** |
| H-03 | `prisma/rls/policies.sql` + cross-tenant.spec.ts | 🟠 | Tests | Cross-tenant gate cubre SELECT + INSERT pero NO UPDATE ni DELETE explícitamente. **23 it.todo HTTP-layer** sin cobertura | **B-CROSS-TENANT** |
| H-04 | `apps/portal/app/api/proxy/[...path]/route.ts` | 🟠 | CSRF | Proxy NO invoca `checkOrigin()` (regresión vs los 3 auth route handlers) | **B-PORTAL-AUTH** |
| H-05 | `apps/portal/next.config.mjs:36-47` + `apps/admin/next.config.mjs` | 🟠 | CSP | `frame-src` faltante → iframe certificate preview cae a `default-src 'self'` blank en prod (admin lo heredará en Sprint 4) | **B-CSP** |
| H-06 | `app/api/auth/[...nextauth]/route.ts:68` | 🟠 | CSRF | Callback Cognito usa `setSessionCookies` legacy `lax` → 2 flows con 2 posturas CSRF | **B-COOKIES-DRY** (cierra junto C-11) |
| H-07 | `app/api/auth/[...nextauth]/route.ts` | 🟠 | CSRF | NextAuth handler dispatcha `logout` por GET con `POST = GET`, sin `checkOrigin()` → `<img src="/api/auth/logout">` desloguea | **B-COOKIES-DRY** |
| H-08 | `auth.controller.ts` (`/v1/auth/refresh`) + ses-webhook | 🟠 | Anti brute-force | 2/6 endpoints `@Public` SIN `@Throttle` → brute-force indefinido | **B-AUTH-SEC** |
| H-09 | `auth.service.spec.ts:95-97` | 🟠 | Tests | `describe.skip` referencia `test/integration/otp-flow.spec.ts` que **NO existe**. Cobertura RF-401 ausente | **B-TESTS-OTP** |
| H-10 | `Certificate.hash` field schema | 🟠 | Integridad | (cerrado por C-01 fix) | **B-PDF** |
| H-11 | `ses.service.ts:154-155` | 🟠 | Email tracking | SDK v3 `SendEmailCommand` SÍ soporta `Tags:[{Name,Value}]` — comment dice lo contrario, fix trivial bloqueado | **B-EMAIL-TAGS** |
| H-12 | `ses-webhook.controller.ts` | 🟠 | Seguridad | Firma SNS validada solo por regex URL (no criptografía). `@Public` sin throttle | **B-WEBHOOK** |
| H-13 | `ses-webhook.controller.ts` | 🟠 | DoS | Webhook sin throttle → atacante con topic ARN inyecta hard-bounces falsos → limpia `insureds.email` | **B-WEBHOOK** |
| H-14 | 16 callers de `PrismaBypassRlsService` | 🟠 | Multi-tenant | Inyectado sin ADR ni helper `assertPlatformAdmin` runtime → JSDoc obliga verify pero no enforce | **B-BYPASS-AUDIT** |
| H-15 | `PrismaService` `bypassRls=true` branch (line 137-141) | 🟠 | Tests | Promesa "NOBYPASSRLS devuelve 0 filas" SIN test integration; solo unit con mocks | **B-CROSS-TENANT** |
| H-16 | 3 services con `as unknown as Prisma.InsuredWhereInput` | 🟠 | Type safety | Cast obsoleto post-migración `cognito_sub` (insureds, claims, certificates) | **B-TYPES-CLEANUP** |
| H-17 | 3 sites: `list`, `buildExportWhere`, `reports-worker.queryInsureds` | 🟠 | DRY | `buildInsuredsWhere` triplicado byte-idéntico → drift garantizado al agregar filtro | **B-DRY** |
| H-18 | `ExportRateLimitGuard` (10/día/tenant) | 🟠 | Tests | Cero tests dedicados al guard anti-abuse PII → edge cases no cubiertos | **B-TESTS-EXPORT** |
| H-19 | 4 archivos byte-idénticos admin↔portal | 🟠 | DRY | `cookie-config.ts`, `origin-allowlist.ts`, `lib/jwt.ts`, proxy ~85% → consolidar `packages/security/` | **B-COOKIES-DRY** |
| H-20 | `apps/admin/vitest.config.ts:39-50` | 🟠 | Coverage façade | `coverage.include` enumera archivos manualmente y EXCLUYE archivos con findings High → thresholds 80/75/80/80 son **cosméticos** | **B-COVERAGE** |
| H-21 | `jest.config.ts:46-48` | 🟠 | Coverage | Sin `coverageThreshold` BE; portal Vitest sin threshold; packages/auth security-critical sin gate | **B-COVERAGE** |
| H-22 | `lighthouserc.js:6` portal | 🟠 | DX/Tests | URL `localhost:3001` (admin port) en vez de `:3002` portal → mide app equivocada → gaps Performance/A11y **ficticios** | **B-COVERAGE** |
| H-23 | 4 endpoints insured-only sin E2E | 🟠 | Tests | `/insureds/me`, `/me/coverages`, `/claims POST`, `/certificates/mine` cero tests E2E + cero tests del proxy | **B-TESTS-PORTAL** |
| H-24 | `claims.controller` audit ctx | 🟠 | Audit gap | OMITE `{ip,userAgent,traceId}` extraction → claims insured registrado **SIN IP/UA en chain hash** | **B-AUDIT** |
| H-25 | `mobile-drawer.tsx:83-91` | 🟠 | UX | Tenant switcher mock hard-coded "mac" en mobile → S3-08 broken on mobile | **B-UX-FIXES** |
| H-26 | `THROTTLE_LIMIT_DEFAULT=10000` + `THROTTLE_ENABLED=false` | 🟠 | Coverage | Enmascara A4-25 + A6-46 + futuros endpoints sin throttle. Bajar a 100 + selective off | **B-COVERAGE** |
| H-27 | `cognito-local-bootstrap.sh:151-155` | 🟠 | UX | Sin `given_name` claim → portal cae a fallback "insured.demo" en lugar de "María" | **B-COGNITO-CLAIMS** |
| H-28 | `packages/api-client/package.json` | 🟠 | Tests | `--passWithNoTests` con 26 hooks sin un solo test | **B-TESTS-API-CLIENT** |
| H-29 | `String.replace(SQS_QUEUE_LAYOUT,…)` | 🟠 | Operacional | Workers fabrican URL SQS via `replace` — funciona LocalStack, falla AWS real (account distinto). Bloquea Sprint 5 deploy | **B-INFRA-SQS** |
| H-30 | 9/12 runbooks `> TBD` + IRP esqueleto puro | 🟠 | Compliance | Operación sin runbooks actionables → on-call sin instrucciones | **B-DOCS** |

---

## 4. Patrones sistémicos (refactor cross-cutting Sprint 4)

| # | Patrón | Confirmaciones | Fix sistémico (1 PR cierra N issues) | Bundle |
|---|---|---|---|---|
| **P1** | `MessageDeduplicationId` standard queue | 5 agentes (A3+A4+A5+A9+B5) | **Eliminar dedupeId de `SqsService.sendMessage`**; idempotencia DB-side con UNIQUE constraints | **B-INFRA-SQS** |
| **P2** | Cookie/CSRF wiring fragmentado | 7 agentes (A1+A7+A8+B1+B7+B8+H-02 sec) | **`packages/security/`** consolidado con `cookie.ts`, `origin.ts`, `proxy.ts` factory; `packages/auth/src/session.ts` → strict | **B-COOKIES-DRY** |
| **P3** | Audit infra fragmentada | 5 agentes (A1+A5+A6+B5+B6) | **`AuditContextFactory`** + extender enum `AuditAction` (`otp.requested`, `otp.verified`, `read.viewed`, `read.downloaded`); 1 redact list | **B-AUDIT** |
| **P4** | Tests fantasma o façade | 6 agentes (A1+A10+B1+B5+B7+B10) | **TDD obligatorio** para los 15 Critical + coverage thresholds reales (no `include` selectivo) en backend + portal + packages | **B-COVERAGE** + **B-TESTS-OTP** + **B-TESTS-PORTAL** |
| **P5** | Hash inconsistencia integridad | 4 agentes (A4+A6+B4+B6) | Fix C-01 (PDF SHA real) + C-10 (chain verifier full SHA) end-to-end | **B-PDF** + **B-AUDIT** |
| **P6** | CloudWatch alarms missing | 3 agentes (A6+A9+B6) | C-14 instanciar 7-10 alarmas core en `envs/{env}/alarms.tf` | **B-OBSERVABILITY** |
| **P7** | DRY admin↔portal | 6 agentes (A5+A7+A8+B5+B7+B8) | `packages/security/` (cookie+origin+proxy) + `buildInsuredsWhere` shared en `packages/data-helpers` | **B-COOKIES-DRY** + **B-DRY** |

---

## 5. Bundles para dispatch paralelo de fixes

> Cada bundle es **disjoint** en archivos: ningún bundle modifica los mismos archivos que otro → pueden correr en paralelo sin race conditions. El número entre paréntesis es la cantidad de issues que cierra.

### B-PDF (cierra 2 issues + cross-cutting P5)

**Owner agent**: Backend Senior PDF/Workers

**Files exclusivos**:
- `segurasist-api/src/workers/pdf-worker.service.ts`
- `segurasist-api/src/modules/certificates/certificates.service.ts`
- `segurasist-api/src/modules/certificates/dto/`
- `segurasist-api/test/integration/cert-integrity.spec.ts` (nuevo)

**Issues**: C-01, H-10, B4-V2-16

**Tests requeridos**:
1. `cert-integrity.spec.ts` recomputa SHA del buffer Puppeteer y compara con `Certificate.hash`.
2. Verify endpoint test con cert real recién emitido.

**Effort**: 4-6h dev + 4h tests = 10h.

---

### B-PORTAL-AUTH (cierra 3 issues, **DEBE coordinarse en mismo PR**)

**Owner agent**: Frontend Senior Portal + Backend Senior Auth

**Files exclusivos**:
- `segurasist-web/apps/portal/app/api/proxy/[...path]/route.ts`
- `segurasist-api/src/infra/aws/cognito.service.ts` (verifyInsuredOtp)
- `segurasist-api/test/integration/otp-flow.spec.ts` (nuevo)

**Issues**: C-02 (proxy cookie), C-03 (cognito_sub no persiste), H-04 (origin allowlist proxy)

**⚠️ Dependencia crítica**: C-02 sin C-03 = portal funcionalmente roto post-fix. **Mismo PR obligatorio**.

**Tests requeridos**:
1. `proxy.spec.ts` Bearer forwarding verificado.
2. `otp-flow.integration.spec.ts` end-to-end Mailpit + cognito_sub persiste.

**Effort**: 30min + 2h + 3h tests = 6h.

---

### B-AUTH-SEC (cierra 2 issues)

**Owner agent**: Backend Senior Auth/Security

**Files exclusivos**:
- `segurasist-api/src/config/env.schema.ts`
- `segurasist-api/src/modules/auth/auth.controller.ts` (refresh decorator)
- `segurasist-api/test/unit/config/env.schema.spec.ts` (extender)
- `.env.example`

**Issues**: C-04 (default password), H-08 (refresh sin throttle)

**Tests**: prod + `Demo123!` → throws; refresh con burst → 429.

**Effort**: 1h + 2h tests = 3h.

---

### B-BATCHES (cierra 4 issues incluyendo 3 Critical)

**Owner agent**: Backend Senior Batches

**Files exclusivos**:
- `segurasist-api/src/modules/batches/batches.service.ts`
- `segurasist-api/src/workers/layout-worker.service.ts`
- `segurasist-api/src/workers/insureds-creation-worker.service.ts`
- `segurasist-api/prisma/schema.prisma` (agregar `processedRows`/`successRows`/`failedRows` columns)
- `segurasist-api/prisma/migrations/20260428_batch_progress_columns/` (nuevo)
- `segurasist-api/test/integration/batches-flow.spec.ts` (extender)

**Issues**: C-05 (chunking duplicates), C-06 (counter race), C-07 (TOCTOU + double event), C-08 (rowsToInclude infinite)

**Tests**: fixtures con duplicates separados >500 rows; carrera de 2 workers concurrentes; subset confirm.

**Effort**: 14h + 10h tests = 24h.

---

### B-INFRA-SQS (cierra 2 issues + cross-cutting P1)

**Owner agent**: DevOps + Backend Workers

**Files exclusivos**:
- `segurasist-api/src/infra/aws/sqs.service.ts`
- `segurasist-api/src/workers/insureds-creation-worker.service.ts:63` (eliminar string-replace)
- `segurasist-api/src/config/env.schema.ts` (agregar `SQS_QUEUE_INSUREDS_CREATION`)
- `.env.example`
- `segurasist-api/scripts/localstack-bootstrap.sh`
- `segurasist-infra/modules/sqs-queue/`
- `segurasist-infra/envs/{dev,staging,prod}/main.tf`
- `prisma/migrations/20260428_insureds_creation_unique/` (UNIQUE constraint)

**Issues**: C-09, H-29, P1 sistémico

**Tests**: sendMessage SIN dedupeId en standard queue, UNIQUE constraint atrapa duplicates.

**Effort**: 5h + 3h tests = 8h.

---

### B-AUDIT (cierra 2 issues + cross-cutting P3)

**Owner agent**: Backend Senior Audit

**Files exclusivos**:
- `segurasist-api/src/modules/audit/audit-chain-verifier.service.ts`
- `segurasist-api/src/modules/audit/audit-writer.service.ts` (exportar `runVerification`)
- `segurasist-api/src/modules/audit/audit-context.factory.ts` (nuevo)
- `segurasist-api/src/common/interceptors/audit.interceptor.ts` (consume AuditContextFactory)
- `segurasist-api/src/common/utils/scrub-sensitive.ts` (única lista)
- `segurasist-api/prisma/schema.prisma` (extender enum `AuditAction`)
- `segurasist-api/prisma/migrations/20260428_audit_action_enum_extend/` (nuevo)
- `segurasist-api/src/modules/auth/auth.service.ts` (consume AuditContextFactory)
- `segurasist-api/src/modules/insureds/insureds.service.ts` (idem)
- `segurasist-api/src/modules/certificates/certificates.service.ts` (idem)
- `segurasist-api/src/modules/claims/claims.controller.ts` (FIX H-24 audit ctx)
- `segurasist-api/test/integration/audit-tampering.spec.ts` (nuevo)

**Issues**: C-10 (chain verifier full SHA), H-01 (factory + enum), H-02 (verify-chain throttle), H-24 (claims audit ctx)

**Tests**: tampering coordinated, factory unit, enum migration roll-forward.

**Effort**: 6h + 6h tests = 12h.

---

### B-COOKIES-DRY (cierra 4 issues + cross-cutting P2 y P7) — **EL FIX MÁS IMPACTANTE**

**Owner agent**: Frontend Senior + Backend Senior packages

**Files exclusivos**:
- `segurasist-web/packages/security/` (nuevo paquete completo)
- `segurasist-web/packages/security/src/cookie.ts` (consolidado)
- `segurasist-web/packages/security/src/origin.ts` (consolidado)
- `segurasist-web/packages/security/src/proxy.ts` (factory)
- `segurasist-web/packages/auth/src/session.ts` → migrar a strict + delegar a packages/security
- `segurasist-web/packages/auth/src/middleware.ts` (usa packages/security)
- `segurasist-web/apps/admin/lib/cookie-config.ts` → re-export de packages/security
- `segurasist-web/apps/admin/lib/origin-allowlist.ts` → re-export
- `segurasist-web/apps/portal/lib/cookie-config.ts` → re-export
- `segurasist-web/apps/portal/lib/origin-allowlist.ts` → re-export
- `segurasist-web/apps/admin/app/api/auth/[...nextauth]/route.ts` (logout POST + Origin)
- `segurasist-web/packages/security/test/` (todos los unit tests, ~50)

**Issues**: C-11 (silent refresh lax), H-06 (callback lax), H-07 (logout GET), H-19 (DRY)

**Tests**: silent refresh strict, logout requires POST + Origin, factory tests con fakery.

**Effort**: 8h + 8h tests + migración consumers = 20h.

---

### B-CI (cierra 2 issues)

**Owner agent**: DevOps Senior CI/CD

**Files exclusivos**:
- `segurasist-api/src/main.ts` (SwaggerModule.setup)
- `segurasist-api/package.json` (deps `@nestjs/swagger` + zod-to-openapi)
- `segurasist-infra/global/iam-github-oidc/main.tf` (agregar 2 roles)
- `.github/workflows/ci.yml` (Trivy job)

**Issues**: C-12 (Swagger), C-13 (tf_plan roles), partial H-30

**Tests**: smoke `curl :3000/v1/openapi.json`, terraform validate.

**Effort**: 3h + 2h tests = 5h.

---

### B-OBSERVABILITY (cierra 1 Critical + 1 cross-cutting P6)

**Owner agent**: DevOps Senior

**Files exclusivos**:
- `segurasist-infra/envs/{dev,staging,prod}/alarms.tf` (nuevo en cada env)
- `segurasist-infra/modules/cloudwatch-alarm/` (extender si necesario)
- `segurasist-infra/docs/runbooks/RB-{001,002,004,005,007}.md` (cerrar TBDs referenciando alarms reales)
- `segurasist-infra/docs/runbooks/RB-013-audit-tampering.md` (nuevo, gatillado por chain verifier discrepancy)

**Issues**: C-14, H-30 partial

**Tests**: terraform plan outputs, smoke trigger fake event → SNS receives.

**Effort**: 8h + 2h tests = 10h.

---

### B-RLS (cierra 1 Critical)

**Owner agent**: Backend Senior Multi-tenant

**Files exclusivos**:
- `segurasist-api/prisma/rls/policies.sql` (agregar `exports`)
- `segurasist-api/scripts/apply-rls.sh` (idempotencia confirmada)
- `segurasist-api/test/integration/apply-rls-idempotency.spec.ts` (nuevo)

**Issues**: C-15

**Tests**: borrar DB → migrate → apply-rls → verify policies all 17 tablas.

**Effort**: 1h + 2h tests = 3h.

---

### B-CSP (cierra 1 issue + preventiva)

**Owner agent**: Frontend Senior

**Files exclusivos**:
- `segurasist-web/apps/portal/next.config.mjs` (CSP `frame-src`)
- `segurasist-web/apps/admin/next.config.mjs` (preventiva Sprint 4)
- `segurasist-web/apps/portal/test/integration/csp-iframe.spec.ts` (nuevo)

**Issues**: H-05 (portal), H-05b (admin preventiva)

**Tests**: iframe certificate carga URL S3 sin block CSP.

**Effort**: 1h + 1h tests = 2h.

---

### B-CROSS-TENANT (cierra 2 issues + cross-cutting H-03)

**Owner agent**: QA Lead + Backend Senior

**Files exclusivos**:
- `segurasist-api/test/security/cross-tenant.spec.ts` (convertir 23 it.todo + agregar UPDATE/DELETE)
- `segurasist-api/test/integration/bypass-rls-defense.spec.ts` (nuevo, integration real)

**Issues**: H-03 (UPDATE/DELETE + 23 todos), H-15 (bypass branch sin integration test)

**Tests**: 23 endpoints cross-tenant HTTP-layer reales (template: `superadmin-cross-tenant.e2e-spec.ts`).

**Effort**: 16-24h.

---

### B-WEBHOOK (cierra 2 issues)

**Owner agent**: Backend Senior

**Files exclusivos**:
- `segurasist-api/src/modules/webhooks/ses-webhook.controller.ts`
- `segurasist-api/package.json` (`aws-sns-validator` o equivalente)
- `segurasist-api/test/integration/ses-webhook-security.spec.ts` (nuevo)

**Issues**: H-12 (SNS firma criptográfica), H-13 (throttle)

**Tests**: firma inválida → 401, throttle 60/min, hard bounce → email NULL atomic.

**Effort**: 4h + 3h tests = 7h.

---

### B-EMAIL-TAGS (cierra 1 issue)

**Owner agent**: Backend Senior Email

**Files exclusivos**:
- `segurasist-api/src/infra/aws/ses.service.ts`
- `segurasist-api/src/workers/email-worker.service.ts`
- `segurasist-api/test/unit/infra/ses-adapter.spec.ts` (extender)

**Issues**: H-11

**Tests**: sendEmail con Tags → mock SES recibe Tags.

**Effort**: 1h + 2h tests = 3h.

---

### B-COVERAGE (cierra 4 issues + cross-cutting P4)

**Owner agent**: QA Lead + DX

**Files exclusivos**:
- `segurasist-api/jest.config.ts` (agregar coverageThreshold 60/55/60/60)
- `segurasist-web/apps/portal/vitest.config.ts` (threshold 60/55/60/60)
- `segurasist-web/apps/admin/vitest.config.ts` (eliminar `include` selectivo, usar `exclude`)
- `segurasist-web/packages/{auth,ui,api-client}/vitest.config.ts` (threshold + include real)
- `segurasist-web/apps/portal/lighthouserc.js:6` (`localhost:3002`)
- `segurasist-api/test/e2e/setup.ts` (`THROTTLE_LIMIT_DEFAULT=100` selectivo)

**Issues**: H-20 (façade admin), H-21 (BE+portal), H-22 (Lighthouse port), H-26 (throttle enmascara)

**Tests**: PR de regresión simulado verifica que coverage falla.

**Effort**: 4h + 2h tests = 6h.

---

### B-TESTS-OTP, B-TESTS-PORTAL, B-TESTS-EXPORT, B-TESTS-API-CLIENT

(Ver detalles en `docs/audit/10-tests-dx-v2.md`).

Effort total: ~40h.

---

### B-DRY, B-BYPASS-AUDIT, B-COGNITO-CLAIMS, B-UX-FIXES, B-DOCS, B-TYPES-CLEANUP

(Detalles en `docs/audit/05-insureds-reports-v2.md`, `docs/audit/02-multitenant-rls-v2.md`, `docs/audit/08-frontend-portal-v2.md`).

Effort total: ~30h.

---

## 6. Plan de remediación Sprint 4 — fases

### Fase 1 — Pre-Go-Live obligatoria (P0, **15 Critical**)

**Bundles paralelos** (ningún bundle bloquea otro al estar disjoint):

| Día | Bundles paralelos |
|---|---|
| **D1** | B-PDF · B-PORTAL-AUTH · B-AUTH-SEC · B-RLS · B-CSP |
| **D2** | B-BATCHES (continúa) · B-INFRA-SQS · B-AUDIT · B-CI · B-OBSERVABILITY |
| **D3** | B-BATCHES (cierra) · B-AUDIT (cierra) · **B-COOKIES-DRY** (cierra C-11 + H-06 + H-07 + H-19) |
| **D4** | Validación full + smoke E2E real Chrome + commit consolidado |

**Effort total Fase 1**: ~110h. **3-4 devs en paralelo = 1 sprint week.**

### Fase 2 — Hardening pre-Sprint 5 pentest (High prioritarios)

| Bundle | Effort |
|---|---|
| B-CROSS-TENANT (23 todos + UPDATE/DELETE) | 24h |
| B-WEBHOOK | 7h |
| B-EMAIL-TAGS | 3h |
| B-COVERAGE | 6h |
| B-TESTS-OTP + B-TESTS-PORTAL + B-TESTS-EXPORT + B-TESTS-API-CLIENT | 40h |

**Effort total Fase 2**: ~80h. **2 devs = 1 sprint week.**

### Fase 3 — DX + DRY + docs (Medium/Low)

| Bundle | Effort |
|---|---|
| B-DRY (consolidar buildInsuredsWhere) | 3h |
| B-BYPASS-AUDIT (helper assertPlatformAdmin runtime) | 3h |
| B-COGNITO-CLAIMS (given_name) | 1h |
| B-UX-FIXES (mobile tenant switcher real) | 3h |
| B-DOCS (9/12 runbooks + IRP actionable) | 12h |
| B-TYPES-CLEANUP (3 casts cognito_sub) | 1h |

**Effort total Fase 3**: ~25h. **1 dev = 3-4 días.**

### Total Sprint 4 estimate: **215h** (~5-6 sprint-weeks de un equipo de 4)

---

## 7. Compliance impact por fix

| Fix | Compliance V2 | Audit Sprint 1 | Pentest readiness |
|---|---|---|---|
| C-01 PDF SHA real | 3.13 OWASP A08 ↑ | M5 audit consolidado | **Crítico para verifiability** |
| C-02 portal cookie | 3.16 API Auth ↑ | M6 sameSite consolidado | Crítico |
| C-03 cognito_sub persist | 3.5 RBAC integridad ↑ | — | Crítico |
| C-04 default password | 3.4 IAM SSO/MFA ↑ | M4 superRefine consolidado | **Pentest BURP test** |
| C-05..C-08 batches | 3.13 A04 Insecure design ↑ | — | Pentest funcional |
| C-09 SQS dedup | 3.21 Monitoreo ↑ | — | Operacional prod |
| C-10 audit chain full SHA | 3.27 Auditoría ↑↑ | H-01..H-03 cierre | **Tampering resistance** |
| C-11 cookies strict | 3.13 A07 Identity ↑ | M6 cierre completo | Crítico |
| C-12+C-13 CI | — | — | Bloquea CI/CD pre-prod |
| C-14 alarms | **3.27 Alertas ↑↑↑** | H-04 cierre | Pentest detection |
| C-15 RLS exports | **3.15 Multi-tenant** | A2-01 cierre | **Pentest critical** |

**Compliance V2 post-Fase 1**: estimado **94-96%** (vs 89.4% actual).

**Audit Sprint 1 post-Fase 1**: **100%** (todos los 13 items cerrados completamente).

---

## 8. Test coverage requirements por fix

| Bundle | Tests añadidos | Target coverage |
|---|---|---|
| B-PDF | +6 (integrity, snapshot, regression) | ≥80% certificates module |
| B-PORTAL-AUTH | +8 (proxy, OTP flow, cognito_sub) | ≥85% portal proxy |
| B-AUTH-SEC | +5 (env validation, refresh throttle) | ≥80% auth |
| B-BATCHES | +12 (chunking, counter race, TOCTOU) | ≥85% workers |
| B-INFRA-SQS | +4 (UNIQUE constraint, no dedup) | ≥80% sqs.service |
| B-AUDIT | +10 (factory, enum, full SHA, claims ctx) | ≥85% audit module |
| B-COOKIES-DRY | +50 (packages/security completo) | ≥90% packages/security |
| B-CI | +3 (smoke openapi, tf validate) | n/a |
| B-OBSERVABILITY | +5 (alarm trigger smoke) | n/a (IaC) |
| B-RLS | +3 (idempotency, exports policy) | ≥90% policies.sql coverage |
| B-CSP | +2 (iframe load) | n/a (config) |
| B-CROSS-TENANT | +23 reales + UPDATE/DELETE | **100% endpoints tenant-scoped** |
| **TOTAL Fase 1+2** | **+131 tests nuevos** | Coverage thresholds reales activados |

---

## 9. Cómo dispatch en paralelo

### Estrategia recomendada

**Paso 1 — Tech Lead (humano)**:
1. Revisar este AUDIT_INDEX.md completo.
2. Aprobar bundles + asignar prioridades (algunas pueden bajar de Critical a High según business decision).
3. Decidir si Fase 1 va en 1 sprint o se divide.

**Paso 2 — Tech Lead orquestrador (Claude Code main agent)**:
Dispatch en **2 oleadas de 5-6 sub-agentes en paralelo**:

**Oleada 1** (D1-D2):
- Sub-agente 1: B-PDF (Backend Senior PDF/Workers)
- Sub-agente 2: B-PORTAL-AUTH (Frontend + Backend Auth — coordinated PR)
- Sub-agente 3: B-AUTH-SEC (Backend Senior Auth)
- Sub-agente 4: B-RLS (Backend Senior Multi-tenant)
- Sub-agente 5: B-CSP (Frontend Senior)
- Sub-agente 6: B-CI (DevOps Senior)

**Oleada 2** (D2-D3):
- Sub-agente 7: B-BATCHES (Backend Senior Batches)
- Sub-agente 8: B-INFRA-SQS (DevOps + Workers)
- Sub-agente 9: B-AUDIT (Backend Senior Audit)
- Sub-agente 10: B-OBSERVABILITY (DevOps)
- Sub-agente 11: B-COOKIES-DRY (Frontend + packages — el más complejo)

**Paso 3 — Validation gate (D4)**:
- Tech Lead corre full validation: lint + typecheck + tests + build.
- Smoke E2E real Chrome contra portal + admin.
- Si todo verde → commit + push consolidado.
- Si fallan: re-dispatch sub-agentes específicos para fix de regresiones.

**Paso 4 — Fase 2 + Fase 3** (semana 2 Sprint 4):
Dispatch similar para High y Medium.

---

## 10. Bitácora de decisiones arquitectónicas requeridas

Antes de dispatch, el Tech Lead debe decidir:

| Decisión | Opciones | Recomendación |
|---|---|---|
| **SQS standard vs FIFO** (P1) | (a) Migrar todas las queues a FIFO; (b) Eliminar dedupId + UNIQUE DB | **(b)** — más simple, idempotencia DB-side es source of truth. ADR-016 |
| **Audit enum extend vs separate table** (P3) | (a) Extender `AuditAction` enum; (b) Tabla `audit_actions` runtime | **(a)** — performance + type safety. Migration trivial |
| **packages/security** (P2+P7) | (a) Nuevo paquete; (b) Mover a packages/auth existente | **(a)** — separación clara security vs auth-flow. ADR-017 |
| **Coverage threshold values** (P4) | (a) 60/55/60/60 inicial; (b) 70/65/70/70 estricto | **(a)** primero, escalar a (b) Sprint 5 |
| **CloudWatch alarms scope inicial** (P6) | (a) 5 alarms core; (b) 10 alarms exhaustivas | **(a)** core (API down, RDS, SQS DLQ, WAF, SES bounce); el resto Sprint 5 |

---

## 11. Apéndice — Reportes individuales

| Reporte | Path | Findings |
|---|---|---|
| A1 Auth (v1+v2) | `01-auth-rbac.md`, `01-auth-rbac-v2.md` | 22 |
| A2 Multi-tenant | `02-multitenant-rls.md`, `02-multitenant-rls-v2.md` | 16 |
| A3 Batches | `03-batches.md`, `03-batches-v2.md` | 28 |
| A4 Certs+Email | `04-certificates-email.md`, `04-certificates-email-v2.md` | 23 |
| A5 Insureds+Reports | `05-insureds-reports.md`, `05-insureds-reports-v2.md` | 17 |
| A6 Audit+Throttler | `06-audit-throttler.md`, `06-audit-throttler-v2.md` | 25 |
| A7 Frontend admin | `07-frontend-admin.md`, `07-frontend-admin-v2.md` | 26 |
| A8 Frontend portal | `08-frontend-portal.md`, `08-frontend-portal-v2.md` | 27 |
| A9 DevOps+IaC | `09-devops-iac.md`, `09-devops-iac-v2.md` | 30 |
| A10 Tests+DX | `10-tests-dx.md`, `10-tests-dx-v2.md` | 28 |

| Auditorías independientes | Path |
|---|---|
| Security V2 compliance | `docs/security/SECURITY_AUDIT_SPRINT_3.md` |
| QA coverage | `docs/qa/QA_COVERAGE_AUDIT_SPRINT_3.md` |
| Bitácora compartida | `docs/audit/_findings-feed.md` |

---

## 12. Glosario rápido

- **TOCTOU**: Time-of-check vs time-of-use — race condition entre verificar y actuar.
- **CSRF**: Cross-Site Request Forgery — atacante en otro origen ejecuta acciones autenticadas.
- **BYPASSRLS**: rol Postgres que ignora Row-Level Security policies (uso solo para superadmin paths).
- **Coverage façade**: thresholds altos enmascarando archivos críticos excluidos del scope.
- **Tampering pre-mirror**: ventana entre INSERT en `audit_log` y mirror a S3 Object Lock — actor con BYPASSRLS puede modificar la fila.
- **Anti-enumeration**: respuestas idénticas para "no existe" vs "no autorizado" para no filtrar info.

---

> **Aprobación pendiente del Tech Lead** — antes de dispatch, revisar este documento, ajustar prioridades según business needs y firmar el plan.
