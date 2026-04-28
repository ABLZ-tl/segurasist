# Audit Report — Tests + DX + linting + docs (B10, 2da vuelta)

> Auditor: Code Auditor independiente (re-revisión A10) · READ-ONLY
> Fecha: 2026-04-25
> Commit base: HEAD del workspace (post-Sprint 3, post-feed 68 findings)
> Insumos: `docs/audit/_findings-feed.md` (68 findings firmadas A1..A10) + reportes 01..10 v1.

## Summary (≤10 líneas)

A10-v1 cerró el inventario de tests y docs con calidad alta, pero **el feed cross-cutting** evidencia que la cobertura aparente está **inflada** por tres patrones sistémicos: (1) `THROTTLE_LIMIT_DEFAULT=10000` en `NODE_ENV=test` enmascara TODO posible regresión de rate-limit (A6-50), (2) ~30 `it.todo`/`describe.skip` ilusorios — incluyendo una **referencia rota** a `test/integration/otp-flow.spec.ts` que cubriría RF-401 y NO existe (A1-20, A10-72), y (3) **0 `coverageThreshold` en jest backend** (A10-71) y `vitest portal` (A10-77). El feed **además** descubre 7 Critical/High que **NO tienen test que los reproduzca** (PDF hash mismatch A4-22, batch confirm() rowsOk increment A3-30, portal proxy SESSION_COOKIE A8-51, ExportRateLimitGuard sin tests A5-38, SES tags descartados A4-23, audit verify-chain unthrottled A6-46, cross-tenant HTTP layer 23 todos A2-34/A10-73). Sprint 4 debe **test-first** estos 7 fixes antes de ajustar código. Adicionalmente, doc drift: 454 vs 650 vs 1094 tests counts (PROGRESS vs Día 4 vs QA Sprint 3).

## a) Inventario consolidado de gaps de tests (skipped / removed / faltantes)

### a.1 Skipped — confirmado en disco (`grep` reciente)

| Archivo:línea | Tipo | Razón documentada | Cubre RF/Funcionalidad | Riesgo |
|---|---|---|---|---|
| `segurasist-api/src/modules/auth/auth.service.spec.ts:95-97` | `describe.skip` + `it.todo` | "OTP usa Redis+Prisma+SES, mocks pendientes" → apunta a `test/integration/otp-flow.spec.ts` que **NO existe** | RF-401 (OTP portal asegurado) | **High** — referencia rota; ilusión de cobertura. |
| `segurasist-api/test/security/cross-tenant.spec.ts:243-285` | 23 `it.todo` HTTP-layer | "matriz visible sin romper build; pendiente bootstrap app.module + cognito-local" | Cross-tenant gate FE↔BE (F1 + F2 + F3 + F4 + F6) | **High** — capa BD blindada (7 tests reales) pero endpoint que use `prismaBypass` accidentalmente NO se detecta. |
| `segurasist-api/test/integration/cert-email-flow.spec.ts:56` | `describe.skip` salvo `CERT_EMAIL_FLOW_E2E=1` | LocalStack + Mailpit reales | RF-302/303 (cert + email flow) | Medium — CI no setea env. |
| `segurasist-api/test/e2e/certificates.e2e-spec.ts:38` | `describe.skip` salvo `CERT_E2E=1` | LocalStack | RF-301..308 | Medium — CI no setea env. |
| `segurasist-api/test/e2e/insureds-export.e2e-spec.ts:88` | `describe.skip` **incondicional** | sin nota inline | RF-203 (export PII) | Medium — 200+ líneas listas, regresión silenciosa. |
| `segurasist-web/tests/e2e/specs/portal-otp.spec.ts:32` | Playwright `test.skip` | "Sprint 3 — startInsuredOtp/verifyInsuredOtp pendientes (501)" | RF-401 | Medium — Sprint 3 ya cerrado en PROGRESS, comentario obsoleto. |
| `segurasist-web/tests/e2e/specs/portal-certificate.spec.ts:25` | Playwright `test.skip` | "Sprint 3 — descarga PDF pendiente" | RF-404 | Medium — idem. |

**Total**: 5 BE skips + 2 Playwright skips + **23 `it.todo`** + **1 referencia rota** (`otp-flow.spec.ts`).

### a.2 Removed — historicamente removidos por "vi.mock factory hoisting"

| Archivo | Estado actual | Cubre |
|---|---|---|
| `apps/admin/components/insureds/export-button.test.tsx` | **Removido**; componente sigue en uso (`page.tsx:23`). | F2/F4 export PII flow FE (cero coverage). |
| `apps/admin/components/claims/claim-form.test.tsx` | **Removido**; componente NO existe en árbol actual (feature diferida). | F2 claims UI — verificar si feature está en Sprint 4. |

### a.3 Faltantes — explícitos del feed (Critical/High sin test que los reproduzca)

| Finding feed | Severidad | Test test-first requerido (Sprint 4) |
|---|---|---|
| **A4-22** `pdf-worker.service.ts:316,357` — `hash` persistido es `provisionalHash` random, NO SHA-256 del PDF; rompe contrato `CertificateIssuedEvent`. | **Critical** | `test/integration/pdf-hash-contract.spec.ts`: subir PDF de prueba, comparar `cert.hash` vs `crypto.createHash('sha256').update(pdfBuffer).digest('hex')`. Y verify-endpoint `verify-endpoint.spec.ts` ampliar caso "hash matches re-render". |
| **A8-51** `apps/portal/app/api/proxy/[...path]/route.ts:2` — proxy importa `SESSION_COOKIE` (admin) en lugar de `PORTAL_SESSION_COOKIE`; insureds nunca obtienen Bearer. | **Critical** | `apps/portal/test/unit/api/proxy.test.ts`: cookie `sa_session_portal` set → upstream recibe `Authorization: Bearer …`; cookie ausente o admin-name → upstream NO recibe Bearer. |
| **A3-29** `layout-worker.service.ts:137-140` — dedup CURP por chunk de 500; cross-chunk no se detecta en path async (>1k filas). | **Critical** | `test/integration/batches-flow.spec.ts` ampliar: fixture XLSX con 1500 filas, 2 CURPs duplicadas en chunks distintos → assert `errors.curp_duplicate >= 2`. |
| **A3-30** `insureds-creation-worker.service.ts:200-218` — `confirm()` no resetea `rowsOk/rowsError`; batch se marca `completed` tras la primera creation. | **Critical** | `test/unit/modules/batches/insureds-creation-worker.spec.ts` ampliar: `confirm()` con `rowsOk=0, rowsError=0` antes de procesar; verificar que counts arrancan limpios. |
| **A9-62** `.github/workflows/ci.yml:367` — api-DAST targeta `/v1/openapi.json` pero `SwaggerModule` no está montado. | **Critical** | Smoke `test/integration/openapi-route.spec.ts`: `request.get('/v1/openapi.json')` → 200 con `{ openapi: '3.0' }`. |
| **A9-63** Terraform — `tf_plan_{staging,prod}` roles inexistentes pero referenciados en workflow. | **Critical** | `infra` tflint/checkov rule en CI que valide presencia de los roles antes de plan. |
| **A4-23** `ses.service.ts:154-155` — `sendViaSes` descarta tags/headers `X-Tag-cert`. | High | `test/unit/modules/email/ses-adapter.spec.ts` ampliar: assert que `SendEmailCommand.input.Tags` incluye `{ Name: 'cert-id', Value: <id> }`. |
| **A4-25** `ses-webhook.controller.ts:67` — POST `/v1/webhooks/ses` público sin throttle. | High | `test/integration/ses-webhook-throttle.spec.ts`: 10 req/sec → 429 a partir del N. |
| **A4-26** SES SNS firma no validada criptográficamente. | High | `test/unit/modules/webhooks/sns-signature.spec.ts`: payload con firma inválida → 401; firma válida → 200. |
| **A2-34** Cross-tenant HTTP layer (23 it.todo). | High | Convertir `it.todo` → `it()` con dos JWTs (tenant A/B). Bootstrap reutilizable de `test/e2e/superadmin-cross-tenant.e2e-spec.ts`. |
| **A2-35** Tabla `exports` no en `policies.sql` array tenant-iso. | High | `test/security/cross-tenant.spec.ts` añadir caso `SELECT * FROM exports` cross-tenant → 0 filas. |
| **A5-37** SQS `MessageDeduplicationId` enviado a `reports-queue` standard (ignorado silente). | High | `test/unit/infra/sqs-fifo-validation.spec.ts`: assert que `dedupeId` solo se envía a colas `.fifo`. |
| **A5-38** `ExportRateLimitGuard` SIN tests dedicados (cap diario PII anti-abuse 10 exports/día). | High | `test/unit/modules/insureds/export-rate-limit.guard.spec.ts`: 10 exports OK; 11vo → 429; reset a las 24h. |
| **A6-45** `recomputeChainOkFromDb` (path source='both') solo encadena prev_hash sin recomputar SHA. | High | `test/unit/modules/audit/audit-chain-verifier.spec.ts` ampliar: tampering coordinado en filas no mirroreadas → `valid=false`. |
| **A6-46** GET `/v1/audit/verify-chain` sin throttle (DoS trivial). | High | `test/integration/throttler.spec.ts` añadir caso para endpoint. |
| **A7-56** `apps/admin/app/api/auth/[...nextauth]/route.ts:10,68` — callback Cognito usa `setSessionCookies` con `sameSite='lax'`. | High | `apps/admin/test/unit/api/nextauth-callback.test.ts`: verificar Set-Cookie con `SameSite=Strict`. |
| **A7-57** Logout sirve por GET (CSRF logout via `<img src>`). | High | `apps/admin/test/unit/api/logout-method.test.ts`: GET → 405; POST sin Origin allow → 403; POST con Origin allow → 200. |
| **A8-52** Portal proxy NO invoca `checkOrigin()`. | High | `apps/portal/test/unit/api/proxy-origin.test.ts`: Origin no allowlist → 403. |
| **A8-53** CSP portal no declara `frame-src` para S3 pre-signed cert. | High | `apps/portal/test/unit/csp-frame-src.test.ts`: header CSP incluye `frame-src https://*.amazonaws.com`. |
| **A9-64** `cloudwatch-alarm` module nunca instanciado. | High | `infra` checkov rule + `terraform plan` snapshot test que verifique al menos 5 alarms. |
| **A9-65** Workers necesitan `insureds-creation-queue`; Terraform crea solo 4. | High | Snapshot test que las 5 queues existen. |
| **A9-66** Falta job docker build + Trivy. | High | `.github/workflows/ci.yml` job + assertion en CI summary. |
| **A9-67** `deploy_*/tf_apply_*` roles con PowerUserAccess/Admin (least-privilege violation). | High | tflint rule + assertion en CI. |
| **A1-20** ExportRateLimitGuard sin tests (duplica A5-38). | High | (cubierto en A5-38). |

### a.4 Tests que enmascaran regresiones

| Test | Patrón | Riesgo |
|---|---|---|
| `src/app.module.ts:91` | `THROTTLE_LIMIT_DEFAULT=10000` hard-coded en `NODE_ENV=test` | TODO test e2e/integration corre con throttle ~ infinito; cualquier endpoint que pierda `@Throttle` no se detecta. **A6-50** |
| `test/e2e/setup.ts:16` | `THROTTLE_ENABLED=false` setado para todo el e2e project | Idem; `insureds-export.e2e-spec.ts:39` lo `delete`-ea localmente como parche, pero el patrón global oculta regresiones. **A10 v1 ya lo notó.** |
| `test/integration/batches-flow.spec.ts:1-34` | Header dice "integration con LocalStack" pero usa **mocks in-memory**; no arranca infra real. | Categorización engañosa — un dev nuevo cree que LocalStack está cubierto. **A3-33** |
| Backend Jest sin `coverageThreshold` | `jest.config.ts:46-48` define `collectCoverageFrom` pero no umbral | Cualquier área puede caer 30 puntos sin alarmar CI. **A10-71** |
| Portal Vitest sin `thresholds` | `apps/portal/vitest.config.ts:29-37` | Portal maneja PII (RF-401..408) sin coverage gate. **A10-77** |

## b) Coverage threshold por módulo (consolidado)

| Módulo / paquete | Tool | Threshold actual | Recomendado Sprint 4 | Gap |
|---|---|---|---|---|
| `segurasist-api` (Jest, 4 projects) | Jest | **NINGUNO** (`jest.config.ts:46-48` `collectCoverageFrom` sin `coverageThreshold`) | `global: { statements:70, branches:60, functions:70, lines:70 }`; `modules/auth` y `modules/insureds` 80/70/80/80 | **High** — toda regresión BE invisible. |
| `apps/admin` | Vitest | **80/75/80/80** sobre **lista limitada** (`include: lib/rbac.ts, lib/auth-server.ts, lib/jwt.ts, app/_components/*`, etc.) | Ampliar `include` a `app/(app)/**`, `components/**`, `app/api/**` | Medium — coverage solo cubre subset; nuevos componentes no entran al gate. |
| `apps/portal` | Vitest | **NINGUNO** (`include: []` vacío + sin `thresholds`) | `60/55/60/60` inicial sobre `app/**, components/**, lib/**` | **High** — F4 (portal asegurado, RF-401..408, PII insureds) sin gate. |
| `packages/ui` | Vitest | NINGUNO (config no auditado en v1) | `70/65/70/70` sobre `src/components/**` | Medium — 13 tests existen, falta gate. |
| `packages/auth` | Vitest | NINGUNO | `80/70/80/80` (sec-critical: cognito.ts, session.ts, middleware.ts) | **High** — security-critical sin gate. |
| `packages/api-client` | Vitest | `--passWithNoTests` (sin tests) | Crear suite minimal (3-5 tests por hook crítico: insureds, certificates, exports); umbral 50/40/50/50 | Medium — 26 hooks sin un solo test. |
| `packages/i18n` | n/a | Sin tests | (no aplica — solo JSON; verificar `pnpm --filter @segurasist/i18n typecheck` cubre). | Low. |
| `packages/config` | n/a | Sin tests | n/a | Low — config files. |

## c) DX issues — consolidado

| ID | Issue | Fuente | Recomendación |
|---|---|---|---|
| B10-DX-01 | Stale `.next` cache en `apps/{admin,portal}/.next/`; QA Sprint 3 lo reportó, A10 v1 dijo `LOCAL_DEV.md` no documenta. **Confirmado**: `LOCAL_DEV.md` 0 menciones de "stale" / "next cache". | A10-79, QA-Sprint-3 | Añadir sección "Reset rápido frontend" con `pnpm --filter @segurasist/{admin,portal} clean && rm -rf apps/{admin,portal}/.next`. |
| B10-DX-02 | `turbo.json:34-37` `test:unit dependsOn ^build` infla CI. Source-mapped packages (api-client/auth/i18n/ui) no requieren build upstream. | A10-76 | Cambiar a `dependsOn: ["^typecheck"]` o sin dependsOn. ROI alto en CI time. |
| B10-DX-03 | ESLint dual config en web: `apps/{admin,portal}/.eslintrc.json` (42B legacy `next lint`) + `eslint.config.mjs` flat. | A10-81 | Decidir un único path: (a) flat con `@next/eslint-plugin-next`, o (b) eliminar flat y mantener `.eslintrc.json` por app. |
| B10-DX-04 | Drift counts: PROGRESS Día 3 = **454**; PROGRESS Día 4 = **650**; QA Sprint 3 = **1094** (677 BE + 417 web). Día 3 mismas sumas no cuadran (192+113+162=467, no 454). **Confirmado en disco**: 67 BE specs + 64 web tests = ~131 archivos (cuenta de archivos, no de `it()`). | A10-78 | Centralizar en QA_COVERAGE como SoT; `find … -name "*.spec.ts" \| wc -l` en CI summary auto-actualiza. |
| B10-DX-05 | Env-gates `CERT_E2E` vs `CERT_EMAIL_FLOW_E2E` naming inconsistente. CI no las setea. | A10-80 | Estandarizar prefijo `E2E_<feature>` (ej. `E2E_CERT`, `E2E_CERT_EMAIL`). Crear job opt-in en `.github/workflows/ci.yml` con matrix. |
| B10-DX-06 | `--max-warnings=25` sin justificación inline en repo. | A10-08 v1 | Documentar en `segurasist-api/README.md` (sección Scripts) por qué se permiten 25 (consistent-type-imports migracional) y baselinear hacia 0/sprint. |
| B10-DX-07 | `.gitkeep` redundantes en `test/{unit,integration,e2e}/` con specs reales. | A10-18 v1 | Eliminar 3 archivos (1 commit). |
| B10-DX-08 | `eslint.config.mjs:1-3` flat config con `ignores: []` vacío — no excluye `dist/`, `.next/`, `coverage/`, etc. | A10-12 v1 | Añadir `ignores: ['**/node_modules', '**/dist', '**/.next', '**/coverage', '**/storybook-static', '**/.turbo']`. |
| B10-DX-09 | `turbo.json:16-19` `tasks.build` sin `inputs`; cualquier cambio (ej. README) invalida cache. | A10-11 v1 | Declarar `inputs` explícito. |
| B10-DX-10 | `pnpm openapi:gen` requiere `OPENAPI_URL` (falla silente sin ella); `segurasist-web/README.md` no lo dice. | A10-90 v1 (docs) | Añadir nota en README web. |

## d) Docs gaps

| Doc | Estado | Gap | Recomendación |
|---|---|---|---|
| **ADRs API** (0001..0005) | ✅ Sin huecos numéricos. | Sin gap. | — |
| **ADRs infra** (000..014) | ✅ Sin huecos. | ADR-014 (mx-central-1) override coherente. | — |
| **`docs/INTERIM_RISKS.md`** | ✅ Cubre **H-01..H-08** (security audit Sprint 3) + H1/H2/H3 (Sprint 1 audit). | OK. | — |
| **`docs/IRP.md`** | ✅ Operativo (497 LOC, P0-P3, runbooks, escalación, templates). | Actionable. | — |
| **`docs/SUB_PROCESSORS.md`** | ✅ 11 vendors + DPA status. | Verificado: ya consistente con `mx-central-1` (region change ADR-014). | — |
| **`docs/LOCAL_DEV.md`** | ⚠️ | **NO menciona stale `.next` cache** (grep 0 matches "stale"/"next cache"); IPv4/IPv6 no cubierto. | Añadir secciones (B10-DX-01). |
| **`README.md` raíz** | ⚠️ Quick-start delegado a 3 sub-READMEs. | Faltante: link directo a `cd segurasist-api && ./scripts/local-up.sh` como entrada one-liner. | A10-76 v1. |
| **`docs/PROGRESS.md`** | ⚠️ | Test counts inconsistentes (454 vs 650 vs 1094); Día 3 sumas no cuadran. | B10-DX-04. |
| **`docs/qa/QA_COVERAGE_AUDIT_SPRINT_3.md`** | ✅ Source of truth para F1-F6 matrix. | Counts inflados por `it.todo`. | Re-ejecutar tras cerrar 23 todos. |
| **`docs/security/SECURITY_AUDIT_SPRINT_3.md`** | ✅ 33 controles V2; H-01..H-08 documentados. | OK. | — |
| **`docs/OWASP_TOP_10_COVERAGE.md`** | ✅ A01..A10 con evidencia + gaps + tests. | OK. | — |
| **`segurasist-web/README.md`** | ⚠️ | `pnpm openapi:gen` requiere `OPENAPI_URL` env var (falla silente). | A10-v1 finding, sigue. |

## e) Test inventory por funcionalidad PRD (F1-F6)

> Conteo **archivos** spec/test (no `it()` blocks). Coverage % aproximado por estructura — sin `coverageThreshold` BE y sin Vitest portal threshold, los % reales no son enforced.

| Funcionalidad | RF | Unit (BE+FE) | Integration | E2E | Cross-tenant gate | Performance | Coverage approx |
|---|---|---|---|---|---|---|---|
| **F1 Carga masiva** | RF-101..108 | BE: 7 (`batches.service`, `parser`, `validator`, `curp-checksum`, `layout-worker`, `insureds-creation-worker`, `layouts.service`); FE: 0 dedicado | `batches-flow.spec.ts` (mocks, NO LocalStack real — A3-33) | `batches.e2e-spec`, `layouts.e2e-spec` | **❌ 3 it.todo** (`/v1/batches/:id`, `/errors`, `/confirm`) | ❌ | **MEDIA** — gaps: dedup cross-chunk (A3-29), confirm rowsOk reset (A3-30). |
| **F2 Dashboard / listados** | RF-201..207 | BE: 5 (`insureds.service`, `reports.service`, `claims.service`, `coverages.service`, `users.service`); FE: 8 admin (`dashboard`, `insured-360`, `insureds-list-search`, `tenant-switcher`, etc.) | `dashboard-cache`, `insureds-search-perf`, `insureds-export`, `insured-360`, `tenant-override` | `insureds-export.e2e-spec` (**skip incondicional**), `tenant-override.e2e-spec`, `superadmin-cross-tenant.e2e-spec` | **❌ 4 it.todo** (insureds, audit, reports, tenant-override) + 1 e2e real (override) | `insureds-search-perf.spec` ✅ | **MEDIA-ALTA** — pero export e2e oculto. |
| **F3 Certificados** | RF-301..308 | BE: 7 (`certificates.service`, `pdf-worker`, `qr-generator`, `template-resolver`, `verify-endpoint`, `email-worker`, `ses-adapter`, `email-template-resolver`); FE: 1 portal (`certificate-page`) | `cert-email-flow` (**gated** `CERT_EMAIL_FLOW_E2E=1`), `object-lock-immutability` | `certificates.e2e-spec` (**gated** `CERT_E2E=1`) | **❌ 3 it.todo** (`/v1/certificates/:id`, `/url`, `/reissue`) | ❌ | **MEDIA-ALTA** — pero hash mismatch (A4-22 Critical) sin test. |
| **F4 Portal asegurado** | RF-401..408 | BE: 0 dedicado (`auth.service` cubre admin); FE: 7 portal (`login-form`, `otp-input`, `home-page`, `coverages-page`, `certificate-page`, `bottom-nav`, `header`) | ❌ ningún integration BE para OTP (referencia rota `otp-flow.spec.ts`) | `portal-otp.spec.ts` + `portal-certificate.spec.ts` **AMBOS test.skip** | n/a (cliente) | ❌ | **MEDIA** — UI unit OK; **0 E2E real**; RF-401 OTP coverage es **ilusoria** (A1-20). |
| **F5 Chatbot** | RF-501..506 | `chat.controller.ts` SIN spec asociado | — | — | **❌ 2 it.todo** (`/v1/chat/history`, `/v1/chat/kb`) | ❌ | **NULA** — Sprint 4 declarado. |
| **F6 Reportes (avanzados)** | RF-601..606 | BE: 2 (`reports.service`, `reports-worker.service`); FE: 0 | — | — | **❌ 1 it.todo** (`/v1/reports/*`) | ❌ | **BAJA** — service layer cubierto; falta integration + e2e + scheduling. |

## f) Plan de remediación tests Sprint 4 — orden recomendado

### Critical (test-first, antes de cualquier fix de código)

1. **A4-22 PDF hash mismatch** → `test/integration/pdf-hash-contract.spec.ts` + amplía `verify-endpoint.spec.ts`. Fix: re-render 2 pasadas o calcular SHA post-render. **Coverage**: certificates ≥80%.
2. **A8-51 Portal proxy SESSION_COOKIE** → `apps/portal/test/unit/api/proxy.test.ts` (3 casos). Fix: 1 LOC import. **Coverage**: portal ≥60%.
3. **A3-29 Layout dedup cross-chunk** → `batches-flow.spec.ts` con fixture 1500 filas. Fix: dedup global pre-chunk. **Coverage**: batches ≥75%.
4. **A3-30 confirm() rowsOk reset** → `insureds-creation-worker.spec.ts`. Fix: reset en `confirm()` start. **Coverage**: batches ≥80%.
5. **A9-62 SwaggerModule + openapi.json** → `openapi-route.spec.ts` smoke. Fix: wire `SwaggerModule.setup`. **Coverage**: bootstrap.
6. **A9-63 tf_plan_{staging,prod} roles** → tflint/checkov gate. Fix: agregar roles en `iam-github-oidc/main.tf`.

### High (orden por dependencia/impacto)

7. **A10-71 Coverage threshold backend** (`jest.config.ts`) — establece el gate antes de los siguientes fixes. Cost: 30 min.
8. **A10-77 Threshold portal vitest** — idem.
9. **A2-34 / A10-73 Cross-tenant HTTP-layer 23 todos** → tests reales con dos JWTs. Reutilizar bootstrap de `superadmin-cross-tenant.e2e-spec.ts`. Cost: 2-3 días.
10. **A5-38 ExportRateLimitGuard tests** → guard.spec.ts (10 OK, 11vo 429, 24h reset).
11. **A6-46 verify-chain throttle** → integration test.
12. **A6-45 audit chain SHA recompute** → spec ampliado tampering coordinado.
13. **A4-23/25/26 SES tags + webhook throttle + SNS firma** → 3 tests.
14. **A7-56/57 NextAuth callback `sameSite=strict` + logout POST-only** → 2 tests admin.
15. **A8-52/53 Portal proxy `checkOrigin()` + CSP `frame-src`** → 2 tests portal.
16. **A2-35 exports en RLS** → cross-tenant.spec.ts caso adicional.
17. **A5-37 SQS dedupeId fifo guard** → unit test infra.
18. **A6-50 / THROTTLE_LIMIT_DEFAULT** → cambiar a `100` (no 10000) en test env y arreglar regresiones que afloren.

### Medium (DX + docs)

19. **B10-DX-01** Documentar stale `.next` en `LOCAL_DEV.md`.
20. **B10-DX-02** `turbo.json` cambiar `dependsOn` a `^typecheck`.
21. **B10-DX-04** Centralizar test-counts en CI summary; sincronizar PROGRESS/QA/audit.
22. **B10-DX-05** Renombrar env-gates a `E2E_*` consistente.
23. **A10-04** `insureds-export.e2e-spec.ts` quitar `describe.skip` incondicional (usar bootstrap-null pattern).
24. **A10-05** Recrear `export-button.test.tsx`.

### Low

25. **B10-DX-03** Decidir flat config único en web.
26. **B10-DX-07** Eliminar `.gitkeep` redundantes.
27. **B10-DX-08** `ignores` ESLint flat.
28. **B10-DX-09** `inputs` en `turbo.json:build`.

## Cross-cutting al feed (nuevos hallazgos B10)

- **B10 → A1/A4/A5/A6/A7/A8**: 7 Critical/High **sin test que los reproduzca**; Sprint 4 debe TDD estos 7 antes de fixes (test-first es **bloqueante**).
- **B10 → A6/A10**: `THROTTLE_LIMIT_DEFAULT=10000` en test enmascara el patrón `webhook público sin throttle` (A4-25, A6-46) **a la vez**; cambiar el default desbloquea detección automática.
- **B10 → A9**: las 6 entradas Critical/High de A9 (cloudwatch alarms, queues, docker+trivy, IAM least-privilege) carecen de **infra test** (terratest/checkov rule custom). Sprint 4 debe añadir snapshot tests Terraform o checkov rules custom.
- **B10 → packages**: `packages/api-client` con `--passWithNoTests` cubre los 26 hooks de los 5 dominios principales **sin un solo test**. Cualquier breaking change en `openapi:gen` no rompe ningún test del package.

## Findings nuevos B10 (≤300 palabras)

**Count**: 14 nuevos findings B10 (10 DX + 4 cross-cutting de tests faltantes que no estaban en feed v1: ExportRateLimitGuard ya estaba como A5-38; SES SNS firma ya estaba como A4-26 — los nuevos son auditorías agregadas: api-client sin tests, packages/auth sin threshold, packages/ui sin threshold, infra sin terratest/checkov rules custom).

**Top 3** (orden por riesgo bloqueante a Go-Live):

1. **7 Critical/High del feed sin test reproductor** (B10-Top-1) — Sprint 4 debe TDD: PDF hash A4-22, portal proxy SESSION_COOKIE A8-51, batch confirm() rowsOk A3-30, layout dedup cross-chunk A3-29, SwaggerModule openapi A9-62, tf_plan roles A9-63, ExportRateLimitGuard A5-38. Sin estos, el fix de código no garantiza no-regresión.
2. **`THROTTLE_LIMIT_DEFAULT=10000` + `THROTTLE_ENABLED=false` en `NODE_ENV=test`** (B10-Top-2) — patrón sistémico que enmascara TODOS los hallazgos de "endpoint sin throttle" del feed (A4-25, A6-46). Bajar a 100 + auditar regresiones inmediatas.
3. **Coverage gates faltantes en 5 de 7 áreas** (B10-Top-3) — backend Jest, portal Vitest, packages auth/ui/api-client. Sin gate, cualquier área puede caer 30 puntos sin alarmar CI; PROGRESS reporta "650 tests" pero el 100% de los `it.todo` cuentan como pass.

**Reference**: `/Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/docs/audit/10-tests-dx-v2.md` (este reporte).
