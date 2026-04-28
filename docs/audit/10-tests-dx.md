# Audit Report — Tests structure + DX + linting + docs (A10)

> Auditor: Code Auditor independiente · READ-ONLY
> Fecha: 2026-04-25
> Commit base: HEAD del workspace (post Sprint 3 / Día 4 audit)

## Summary (≤10 líneas)

El stack de tests es **maduro y bien estructurado** (4 projects Jest BE + Vitest jsdom web + Playwright cross-app), con mocks tipados (`DeepMockProxy<PrismaService>`), setup global con cleanup, polyfills (matchMedia/IO/RO/scrollIntoView) y un stub idiomático de `framer-motion`. Linting backend tiene override de tests bien razonado; flat config web es limpio; Prettier + EditorConfig coherentes entre repos. **Docs son excepcionales** (IRP, INTERIM_RISKS, OWASP A01-A10, SUB_PROCESSORS, ADRs sin huecos). Los gaps no son de calidad sino de **cobertura declarada vs ejecutada**: 23 `it.todo` cross-tenant HTTP, 4 archivos `describe.skip` (cert-email-flow, certificates.e2e, insureds-export.e2e, auth.service otpRequest/Verify), 2 Playwright `test.skip` portal, **0 `coverageThreshold` en Jest backend** (web admin sí lo tiene), referencia rota a `test/integration/otp-flow.spec.ts` (no existe), y dos componentes (`claim-form`, `export-button`) sin test asociado pese a estar en uso.

## Files audited

**Test infra (10)**: `segurasist-api/jest.config.ts`, `segurasist-api/test/{mocks,e2e/setup.ts}/*`, `segurasist-web/apps/{admin,portal}/vitest.{config,setup}.ts`, `segurasist-web/apps/{admin,portal}/test/{setup.ts,helpers/*,stubs/*}`.
**Linting/format (8)**: `segurasist-api/.eslintrc.json`, `.prettierrc`, `.editorconfig`; `segurasist-web/eslint.config.mjs`, `packages/config/eslint.config.mjs`, `.prettierrc`, `.editorconfig`, `.npmrc`.
**TS configs (8)**: `packages/config/tsconfig.{base,lib,next}.json`; `apps/{admin,portal}/tsconfig.json`; `packages/{api-client,auth,i18n,ui}/tsconfig.json`.
**Package + scripts (5)**: `segurasist-api/package.json`, `segurasist-web/package.json`, `segurasist-web/turbo.json`, `pnpm-workspace.yaml`, `packages/api-client/package.json` (exports).
**Docs (29+)**: `README.md` raíz, `docs/{PROGRESS,INTERIM_RISKS,IRP,SUB_PROCESSORS,OWASP_TOP_10_COVERAGE,LOCAL_DEV}.md`, `docs/{security,qa,audit}/*`, `external/*.md` (14), 3 READMEs de subrepos, 5 ADRs API, 15 ADRs infra.
**Test files counted**: API ~65 spec files; Web ~50 test files (apps + packages + tests/e2e/specs).

## Strengths

- **Mocks tipados**: `mockPrismaService()` retorna `DeepMockProxy<PrismaService>` (`jest-mock-extended`) — el mock no se desincroniza del contrato real. `mockHttpContext` tipa `ExecutionContext` cubriendo `switchToHttp/Rpc/Ws`.
- **Cleanup automático y consistente**: `apps/admin/test/setup.ts:21-23` y `apps/portal/vitest.setup.ts:20-22` corren `cleanup()` + `restoreAllMocks` en `afterEach`. Storage shim, cookieJar y `routerStub` se resetean por test.
- **Polyfills jsdom completos**: `matchMedia`, `IntersectionObserver`, `ResizeObserver`, `Element.prototype.scrollIntoView` y, en portal, `hasPointerCapture/releasePointerCapture` — necesarios para Radix/cmdk/framer-motion. **Stub `framer-motion` idiomático** (`Proxy` + `stripMotionProps`) evita warnings DOM y es reutilizado en ambos apps.
- **Jest projects bien separados**: `unit | integration | e2e | security` con `--runInBand` solo donde toca (integration/e2e/cross-tenant). `setupFiles` para e2e centraliza `THROTTLE_ENABLED=false` y `COGNITO_ENDPOINT=0.0.0.0:9229` (evita drift entre suites).
- **ESLint overrides para tests**: deshabilita `no-non-null-assertion`, `no-unsafe-*`, `unbound-method` en `**/*.spec.ts` y `test/**/*.ts` (`.eslintrc.json:38-51`) — pragmático sin debilitar producción.
- **TS strict + noUncheckedIndexedAccess** en `tsconfig.base.json` y aliases consistentes (`@common/*`, `@modules/*`, `@infra/*`, `@config/*`) entre `tsconfig.json` y `jest.config.ts moduleNameMapper`.
- **`api-client/exports`**: cubre **todos** los hooks reales (insureds, batches, certificates, packages, reports, dashboard, chat, auth, exports, claims) + `./src/client` — sin desincronización con `src/hooks/`.
- **Docs excepcionales**: IRP (497 líneas, P0–P3, runbooks, templates), INTERIM_RISKS (Object Lock interim + crontab + macOS launchd + restore), OWASP Top 10 con evidencia por A01-A10, SUB_PROCESSORS con DPA status, LOCAL_DEV con boot sequence + .env overrides + diferencias deliberadas dev↔prod.
- **ADRs sin huecos**: API `0001..0005`, infra `001..014` (+ `000-template.md`).
- **Scripts hacen pre-check de binarios** (`backup.sh:84-92` valida aws/pg_dump/sha256sum; `local-up.sh:26-39` valida docker/node/aws/psql; `seed-bulk-insureds.sh:36`; `cognito-local-bootstrap.sh:47` con un loop tooling).

## Issues found

| ID | File:line | Severity | Category | Description | Recommendation |
|---|---|---|---|---|---|
| A10-01 | `segurasist-api/jest.config.ts:46-48` | **High** | Test-coverage | `collectCoverageFrom` definido pero **sin `coverageThreshold`** — `npm run test:cov` no falla por baja cobertura. PROGRESS.md cita "248 BE unit tests" pero no hay umbral mínimo enforced para evitar regresión. | Añadir `coverageThreshold: { global: { statements: 70, branches: 60, functions: 70, lines: 70 } }` y bumparlo por sprint. Web admin ya lo hace (`vitest.config.ts:56-61`, 80/75/80/80). |
| A10-02 | `segurasist-api/src/modules/auth/auth.service.spec.ts:93-97` | **High** | Test-coverage | Comentario apunta a `test/integration/otp-flow.spec.ts` como "cobertura interim" pero **el archivo NO existe**. `describe.skip` + `it.todo`. Cubre RF-401 (OTP) crítico para el portal asegurado. | Crear `test/integration/otp-flow.spec.ts` (gated por env como `cert-email-flow`) o, mínimo, eliminar la referencia falsa del comentario para evitar engaño en code review. |
| A10-03 | `segurasist-api/test/security/cross-tenant.spec.ts:243-285` | **High** | Test-coverage | **23 `it.todo`** en HTTP-layer cross-tenant. Sólo la capa BD (RLS) está blindada (7 tests reales). Cualquier endpoint que se salte `prisma.client` (uso accidental de `prismaBypass`) o devuelva datos de otro tenant via JSON-shape no se detecta. Gate de PR explícito en README pero no enforcement HTTP. | Plan para Sprint 4: convertir los 23 todos en specs e2e reales con dos JWTs (tenant A/B) — esfuerzo estimado 2-3 días. Endpoints más críticos primero: `GET /v1/audit/log`, `GET /v1/insureds`, `GET /v1/certificates/:id`. |
| A10-04 | `segurasist-api/test/integration/cert-email-flow.spec.ts:56`, `test/e2e/certificates.e2e-spec.ts:38`, `test/e2e/insureds-export.e2e-spec.ts:88` | **Medium** | Test-coverage | 3 suites con `describe.skip` o gated por env vars (`CERT_E2E=1`, `CERT_EMAIL_FLOW_E2E=1`). `insureds-export.e2e-spec.ts` está skip incondicional pese a tener 200+ líneas listas. Riesgo: regresión silenciosa cuando el código bajo test cambie. | (a) `insureds-export.e2e`: quitar el `describe.skip` global, usar el patrón `bootstrapApp() returns null → skipped with warn` que ya tiene. (b) Documentar las env-gates en `README.md` (sección Tests) y añadir un job opt-in en CI que las setee. |
| A10-05 | `segurasist-web/apps/admin/components/insureds/export-button.tsx`, `.../app/(app)/insureds/page.tsx:23` | **Medium** | Test-coverage | `export-button.tsx` (6.4K, en uso real) **no tiene** `*.test.tsx`. Audit `_findings-feed` en otros agentes menciona que `export-button.test.tsx` y `claim-form.test.tsx` fueron removidos por hoisting de `vi.mock`. Pero `claim-form` ya no existe en el árbol (no hay regresión real, sí hay registro pendiente). | Recrear `export-button.test.tsx` con el patrón ya usado en `insureds-list-search.test.tsx` (mock de hooks `@segurasist/api-client/hooks/exports` directamente, sin hoisting). Si `claim-form` se difirió a Sprint 4, dejar nota en PROGRESS. |
| A10-06 | `segurasist-web/apps/portal/vitest.config.ts:29-37` | **Medium** | Test-coverage | Portal NO declara `thresholds` (admin sí, 80/75/80/80). Coverage opcional para el portal asegurado pese a que F4 (RF-401..408) maneja PII de insureds. | Añadir `thresholds` con un suelo coherente (60/55/60/60 inicial; subir cuando S3 cierre). |
| A10-07 | `segurasist-web/tests/e2e/specs/portal-otp.spec.ts:32`, `portal-certificate.spec.ts:25` | **Medium** | Test-coverage | 2 Playwright `test.skip` con justificación clara (Sprint 3 backend OTP). Pero el repo ya está en Sprint 3 "cerrado" (PROGRESS.md). | Re-evaluar: si OTP Cognito ya implementado, des-skipear. Si difiere a Sprint 4, mover el comentario "(pendiente Sprint 3)" a "(Sprint 4)" para evitar drift. |
| A10-08 | `segurasist-api/package.json:17` | **Low** | DX | `lint` corre con `--max-warnings=25` sin justificación inline ni comentario en repo. PROGRESS y audit Sprint 3 lo mencionan pero un dev nuevo no sabe por qué hay tolerancia. | Documentar en README (sección Scripts) por qué se permiten 25 (ej. `consistent-type-imports` warn migracional) y baselinear hacia 0 cada sprint. |
| A10-09 | `segurasist-web/apps/admin/.eslintrc.json` (42B) y `apps/portal/.eslintrc.json` (42B) | **Low** | Pattern | Archivos micro (probablemente sólo `{ "extends": "next/core-web-vitals" }`) — `eslint-config-next` se solapa con la flat config en `eslint.config.mjs`. Riesgo: dos sistemas de configuración (legacy `.eslintrc.json` + flat) corriendo según el comando (`pnpm lint` vs `next lint`). | Migrar a flat config único; `apps/{admin,portal}/package.json:lint` ya usa `next lint` que lee `.eslintrc.json`, pero `turbo run lint` espera coherencia. Decidir un solo path. |
| A10-10 | `segurasist-web/turbo.json:34-37` | **Low** | DX | `test:unit` declara `dependsOn: ["^build"]` — fuerza build de todos los upstream packages antes de correr unit tests, encarece el ciclo local. Para packages source-mapped (`api-client`, `auth`, `i18n`, `ui`) los tests deberían leer `src/` directo. | Cambiar a `dependsOn: ["^typecheck"]` o quitar dependsOn (tests en monorepos source-mapped no requieren build upstream cuando los `exports` apuntan a `src/`). |
| A10-11 | `segurasist-web/turbo.json:16-19` | **Low** | DX | `tasks.build` no declara `inputs`, así que cualquier cambio (ej. `README.md`) invalida la cache. | Declarar `inputs: ["src/**", "*.{ts,tsx,json,mjs}", "next.config.mjs", "tailwind.config.ts"]` para mejorar hit-rate. |
| A10-12 | `segurasist-web/eslint.config.mjs:1-3` + `packages/config/eslint.config.mjs:11-13` | **Low** | Pattern | Bloque `ignores: []` vacío en flat config — `dist/`, `.next/`, `node_modules/`, `coverage/`, `storybook-static/` no están explícitamente ignorados (TS los excluye via `tsconfig.base.json:30`, pero ESLint flat config no hereda eso). | Añadir `ignores: ['**/node_modules', '**/dist', '**/.next', '**/coverage', '**/storybook-static', '**/.turbo']` al primer bloque para acelerar `eslint .`. |
| A10-13 | `docs/PROGRESS.md:97`, `docs/qa/QA_COVERAGE_AUDIT_SPRINT_3.md:12` | **Low** | Docs/Clarity | Counts inconsistentes entre docs: PROGRESS Día 3 dice **454 unit tests** (192 BE + 113 admin + 162 packages); Día 4 audit dice **650 tests automatizados**; QA Sprint 3 dice **1,094 tests** (677 BE + 417 web). Drift narrativo. | Centralizar en QA_COVERAGE como fuente de verdad y referenciar desde PROGRESS con linkback. Auto-generar el count vía `find … -name "*.spec.ts"` en CI summary. |
| A10-14 | `docs/LOCAL_DEV.md` (full file) | **Low** | Docs | NO menciona el gap "stale `.next` cache" reportado en QA Sprint 3 (`apps/admin/.next/` y `apps/portal/.next/` pueden devolver páginas cacheadas tras cambios en server components). | Añadir sección "Reset rápido frontend" con `pnpm --filter @segurasist/admin clean && rm -rf apps/admin/.next` o guidance para `next dev --turbo` cuando aplique. |
| A10-15 | `segurasist-api/.editorconfig` vs `segurasist-web/.editorconfig` | **Low** | Maintainability | `segurasist-api/.editorconfig` declara reglas adicionales (`charset`, `Makefile`/tab) que `segurasist-web/.editorconfig` no. No es un bug, pero una sola fuente compartida evitaría drift. | Raíz `.editorconfig` con `root = true` y los dos sub-repos heredando (o symlink). Costo cero; gain consistencia. |
| A10-16 | `segurasist-api/jest.config.ts:33-38` | **Low** | Clarity | Comentario explica que `setup.ts` no se carga via `testMatch` y se usa `setupFiles`, pero el patrón **único** del project `e2e` mezcla `*.spec.ts` y `*.e2e-spec.ts` — inconsistente con el resto. Un test e2e nombrado `*.spec.ts` corre tanto en `unit` (matchea `<rootDir>/test/unit/**`) como en `e2e` si se mueve mal. | Reservar `*.e2e-spec.ts` exclusivo para e2e, refactorizar 15 archivos en `test/e2e/*.e2e-spec.ts` (ya cumplen) y simplificar el matcher a sólo `**/*.e2e-spec.ts`. |
| A10-17 | `segurasist-web/apps/admin/test/unit/api/local-login.test.ts` (referenciado en setup.ts) | **Low** | Pattern | `vi.stubEnv` se usa en 3 archivos web (`cookie-config.test.ts` x2 + `local-login.test.ts`), pero el setup global no documenta convención. Audit Sprint 1 mencionó que NODE_ENV stubbing fue una fuente de drift. | Documentar en `apps/admin/test/setup.ts` un comentario de "patterns": prefer `vi.stubEnv('NODE_ENV', 'production')` over `process.env.NODE_ENV = 'production'`. |
| A10-18 | `segurasist-api/test/unit/.gitkeep`, `test/integration/.gitkeep`, `test/e2e/.gitkeep` | **Low** | Maintainability | `.gitkeep` redundantes en directorios que ya tienen `*.spec.ts` reales. | Eliminar los 3 `.gitkeep`. |

## Tests skipped/removed inventory

| Archivo:línea | Tipo | Razón documentada | Esfuerzo Sprint 4 |
|---|---|---|---|
| `segurasist-api/src/modules/auth/auth.service.spec.ts:95` | `describe.skip` `otpRequest/otpVerify` + 1 `it.todo` | "tests pendientes — flujo OTP usa Redis+Prisma+SES, requiere mocks" | M (1 día). Mock Redis (ioredis-mock), Prisma deep, SesService stub. |
| `segurasist-api/test/security/cross-tenant.spec.ts:243-285` | 23 `it.todo` (insureds 5, batches 3, certificates 3, claims 2, packages/coverages 2, audit 1, chat 2, reports 1, tenant-override 4) | "matriz de gates HTTP visible sin romper build; pendiente bootstrap app.module + cognito-local" | L (2-3 días). Reutilizar bootstrap de `test/e2e/superadmin-cross-tenant.e2e-spec.ts`. |
| `segurasist-api/test/integration/cert-email-flow.spec.ts:56` | `describe.skip` por env `CERT_EMAIL_FLOW_E2E=1` | gated explícito; LocalStack + Mailpit reales | XS (0). Sólo correr con env on en un job CI dedicado. |
| `segurasist-api/test/e2e/certificates.e2e-spec.ts:38` | `describe.skip` por env `CERT_E2E=1` | gated explícito | XS (0). Idem. |
| `segurasist-api/test/e2e/insureds-export.e2e-spec.ts:88` | `describe.skip` incondicional | sin nota inline (TODO documentar) | S (0.5 día). Sustituir por skip-condicional sobre `bootstrapApp() === null`. |
| `segurasist-web/tests/e2e/specs/portal-otp.spec.ts:32` | `test.skip` Playwright | "Sprint 3 — startInsuredOtp/verifyInsuredOtp pendientes (501)" | M (1 día) si OTP cerrado en Sprint 4. |
| `segurasist-web/tests/e2e/specs/portal-certificate.spec.ts:25` | `test.skip` Playwright | "Sprint 3 — descarga PDF asegurado pendiente" | S (0.5 día) cuando GET `/v1/certificates/mine` cerrado. |
| `claim-form.test.tsx` (referenciado en findings-feed cross-cutting) | **Removido durante consolidación** | "vi.mock factory hoisting" | NA — `claim-form` no existe en el árbol actual; verificar si la feature se difirió. |
| `export-button.test.tsx` (referenciado en findings-feed) | **Removido durante consolidación** | "vi.mock factory hoisting" | S (0.5 día). Componente sigue en uso en `apps/admin/app/(app)/insureds/page.tsx`. |

**Total**: 9 áreas con cobertura diferida; **23 it.todo** + **5 describe.skip/test.skip** + **2 archivos eliminados** + **1 referencia rota** (`otp-flow.spec.ts` mencionado pero inexistente).

## Docs auditadas

| Doc | Estado | Findings |
|---|---|---|
| `README.md` (raíz) | ✅ | Quick-start sólo via 3 sub-READMEs; no menciona `./scripts/local-up.sh` (existe en `segurasist-api/scripts/`). Mejor: añadir link `cd segurasist-api && ./scripts/local-up.sh`. |
| `docs/PROGRESS.md` | ⚠️ | Tests counts inconsistentes (ver A10-13). Día 3 sumas no cuadran (192+113+162=467, no 454). |
| `docs/INTERIM_RISKS.md` | ✅ | Cubre H-01..H-08 implícitamente vía objects-lock + WAF + retención + audit chain. Excelente nivel de detalle (crontab macOS/Linux). |
| `docs/IRP.md` | ✅ | Operativo, P0-P3, escalación, runbooks pointers. |
| `docs/SUB_PROCESSORS.md` | ✅ | Incluye 11 vendors + DPA status (no contado, asumido por header). |
| `docs/OWASP_TOP_10_COVERAGE.md` | ✅ | A01..A10 con evidencia + gaps + tests (excede V2). |
| `docs/LOCAL_DEV.md` | ⚠️ | Ver A10-14 (no menciona stale `.next`). |
| `docs/security/SECURITY_AUDIT_SPRINT_3.md` | ✅ | Auditoría reciente exhaustiva (33 controles V2). |
| `docs/qa/QA_COVERAGE_AUDIT_SPRINT_3.md` | ✅ | Identifica los mismos gaps (cross-tenant HTTP, performance 0, portal e2e skip). |
| `external/AWS-001-cuentas-aws-organizations.md` | ✅ | Coherente con `mx-central-1` primaria + `us-east-1` DR. |
| `external/AWS-002-ses-sandbox.md` | ✅ | Idem (cuenta prod, mx-central-1). |
| `external/AWS-003-dominio-route53-acm.md` | ✅ | (no auditado en detalle por scope). |
| `external/AWS-004-region-mx-central-availability.md` | ✅ | (idem). |
| `segurasist-api/README.md` | ✅ | Scripts npm relevantes documentados; menciona DAST OWASP ZAP local. |
| `segurasist-web/README.md` | ✅ | OK pero faltante: `pnpm openapi:gen` requiere `OPENAPI_URL` env var (falla silente sin ella). |
| `segurasist-infra/README.md` | ✅ | Pre-requisitos one-time bien listados. |
| `segurasist-api/docs/adr/0001..0005-*.md` | ✅ | Sin huecos. |
| `segurasist-infra/docs/adr/000-template.md + 001..014-*.md` | ✅ | Sin huecos; ADR-014 (mx-central-1) overrides ADR-002/006/etc. |

## Cross-cutting concerns (al feed compartido)

- **A10 → A1**: `auth.service.spec.ts:93` referencia `test/integration/otp-flow.spec.ts` que NO existe; agente A1 ya lo notificó. Confirmado por A10: además, `describe.skip` mantiene ilusión de cobertura RF-401.
- **A10 → A1/A2**: 23 it.todo cross-tenant HTTP layer en `test/security/cross-tenant.spec.ts`. Cualquier endpoint nuevo en Sprint 4 hereda el gap. RLS BD blindada (7 tests reales) pero un service que use `prismaBypass` accidentalmente no se detecta.
- **A10 → A4**: `cert-email-flow.spec.ts` y `certificates.e2e-spec.ts` ambos gated por env vars distintas (`CERT_EMAIL_FLOW_E2E` vs `CERT_E2E`). Naming inconsistente; CI no las activa.
- **A10 → A7**: `apps/admin/components/insureds/export-button.tsx` sin test (.tsx existe pero su `*.test.tsx` se removió). Endpoint S3-09 expuesto sin verificación FE.
- **A10 → A9**: `turbo.json:test:unit dependsOn ^build` infla CI time; root cause de "build cache miss" reportado en otras áreas.
- **A10 → A1/A6**: `THROTTLE_ENABLED=false` setado en `test/e2e/setup.ts:16` aplica a TODOS los e2e — un endpoint e2e accidentalmente dependiente de throttling no se cubre. Mitigación interim: `insureds-export.e2e-spec.ts:39` lo `delete`-ea localmente.

## Recomendaciones DX top 5 (Sprint 4)

1. **Configurar `coverageThreshold` en `jest.config.ts`** (A10-01) y umbrales en `apps/portal/vitest.config.ts` (A10-06). Empezar conservador (60/55/60/60) y subir 5 puntos por sprint. Costo: 30 min; ROI: detección de regresión.
2. **Convertir 23 `it.todo` cross-tenant HTTP a tests reales** (A10-03) — gate de PR ya existe, pero hoy sólo cubre BD. Reutilizar bootstrap de `superadmin-cross-tenant.e2e-spec.ts`. Esfuerzo: 2-3 días; ROI: cierra el gap más visible del audit Sprint 3.
3. **Recrear `export-button.test.tsx` y crear `otp-flow.integration.spec.ts`** (A10-02, A10-05) — mock direct de hooks (no factory hoisting); el patrón ya existe en `insureds-list-search.test.tsx`. Costo: 1 día; ROI: cierra dos referencias rotas + componente con PII en uso.
4. **Centralizar test-counts en CI summary y referenciar desde PROGRESS** (A10-13) — un step `find … -name "*.spec.ts" | wc -l` en `web-ci.yml` + `api-ci.yml` que actualice un badge auto-evita drift narrativo. Costo: 2h; ROI: doc fidelity.
5. **Migrar a flat ESLint único en web** (A10-09) y declarar `ignores` (A10-12) — actualmente hay `eslint.config.mjs` + `apps/{admin,portal}/.eslintrc.json` (legacy de `next lint`). Decidir uno: o (a) flat config con plugin `@next/eslint-plugin-next` y `pnpm lint` único, o (b) eliminar el flat y mantener `.eslintrc.json` por app. Costo: 1 día; ROI: un solo path mental para devs.

## Recomendaciones bonus

- **`scripts/local-up.sh`** (A9 territory pero relevante para DX): hacer pre-checks **idempotentes** ya están bien; añadir un `--skip-deps` para devs con stack ya arriba que sólo quieren re-bootstrap de cognito.
- **Documentar `--max-warnings=25`** (A10-08) en CONTRIBUTING o README — evita preguntas en code review.
- **Borrar `.gitkeep` redundantes** (A10-18) — pulido; 1 commit.
