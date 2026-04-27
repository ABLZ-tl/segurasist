# QA Coverage Audit — Sprint 3 (commit a8af110)

Fecha: 2026-04-25
Autor: QA Lead independiente (auditoría READ-ONLY)
Alcance: backend NestJS (`segurasist-api`) + frontend Next.js monorepo (`segurasist-web`).
Documentos base: `MVP_01_PRD_SegurAsist`, `MVP_02_Plan_Proyecto_SegurAsist`, `MVP_07_QA_Pruebas_SegurAsist`.

---

## 1. Resumen ejecutivo

El MVP cierra Sprint 3 con **1,094 tests automatizados** (677 backend + 417 web) y la mayoría
de la pirámide concentrada en unit tests (~87%). Funcionalmente, **F1 carga masiva**, **F2
dashboard/listados**, **F3 certificados** y **F4 portal asegurado (UI)** están
**razonablemente cubiertos** vía unit + integration + e2e con happy path; **F5 chatbot** y
**F6 reportes** quedan para Sprint 4 (cero cobertura). El gate cross-tenant a nivel BD
(RLS) está blindado, pero el **gate HTTP** sigue como `it.todo` (23 casos pendientes) y los
**tests de portal asegurado E2E (OTP + descarga certificado)** están `test.skip` en
Playwright. **No existen tests de performance (k6/JMeter) ni Lighthouse CI activo**, ambos
exigidos por `MVP_07 §6.1`. La cadena DAST/SAST/SCA/Trivy está configurada en CI
(`api-ci.yml` + `web-ci.yml`) pero el audit no encontró evidencia de ejecuciones
completadas en el repo (sólo configuración).

**Top-5 gaps**:
1. Cross-tenant HTTP gate: 23 `it.todo` sin convertir a tests reales (sólo capa BD probada).
2. Performance: 0 scripts k6, 0 lighthouseCI ejecutado en CI (config existe pero no se corre).
3. Portal asegurado E2E: `portal-otp.spec.ts` y `portal-certificate.spec.ts` ambos `test.skip`.
4. F5 chatbot y F6 reportes (avanzados): `service.spec` existe para reports pero no hay
   integration ni e2e; chat carece totalmente de tests más allá del controller.
5. Coverage real desconocido: jest config recolecta coverage pero no hay umbrales de fallo
   configurados (`coverageThreshold` ausente en `jest.config.ts`).

---

## 2. Matriz de cobertura por funcionalidad MVP (F1–F6)

| Func | RFs | Unit/Integration | E2E | Cross-tenant HTTP | Cobertura cualitativa |
|------|-----|------------------|-----|-------------------|------------------------|
| **F1 Carga masiva** | RF-101..108 | `batches.service.spec`, `parser.spec`, `validator.spec`, `curp-checksum.spec`, `layout-worker.spec`, `insureds-creation-worker.spec`, `batches-flow.spec` (integration) | `batches.e2e-spec`, `layouts.e2e-spec` | `it.todo` (3) | **ALTA** — pipeline completo de upload→parse→validate→insert→cert trigger probado. |
| **F2 Dashboard / listados** | RF-201..207 | `insureds.service.spec`, `reports.service.spec`, `dashboard-cache.spec`, `insureds-search-perf.spec`, `insureds-export.spec`, `insured-360.spec` | `insured-360.e2e-spec`, `insureds-export.e2e-spec` (skip), `tenant-override.e2e-spec`, `superadmin-cross-tenant.e2e-spec` | `it.todo` (4) + 1 e2e real (override) | **MEDIA-ALTA** — KPIs + listado + 360 cubiertos; export e2e está `describe.skip`; RF-207 (selector tenant) cubierto por superadmin e2e. |
| **F3 Certificados** | RF-301..308 | `certificates.service.spec`, `pdf-worker.spec`, `qr-generator.spec`, `template-resolver.spec`, `verify-endpoint.spec`, `cert-email-flow.spec` (integration, gated), `email-worker.spec`, `ses-adapter.spec`, `email-template-resolver.spec`, `object-lock-immutability.spec` | `certificates.e2e-spec` (gated `CERT_E2E=1`) | `it.todo` (3) | **MEDIA-ALTA** — pipeline PDF + QR + email + Object Lock cubierto; e2e principal gated por env var (no corre por defecto en CI). |
| **F4 Portal asegurado** | RF-401..408 | Web: `login-form.test.tsx`, `otp-input.test.tsx`, `home-page.test.tsx`, `coverages-page.test.tsx`, `certificate-page.test.tsx`, `bottom-nav.test.tsx`, `header.test.tsx` | `portal-otp.spec.ts` y `portal-certificate.spec.ts` **AMBOS `test.skip`** | n/a (cliente) | **MEDIA** — UI unit OK, pero **0 E2E real**. RF-401 (OTP), RF-404 (descarga PDF) sin verificación end-to-end. RF-406 (reportar siniestro), RF-407/408 (responsive/a11y) sin tests. |
| **F5 Chatbot** | RF-501..506 | `chat.controller.ts` existe sin `*.spec.ts` asociado | — | `it.todo` (2) | **NULA** (Sprint 4). |
| **F6 Reportes (avanzados)** | RF-601..606 | `reports.service.spec`, `reports-worker.service.spec` | — | `it.todo` (1) | **BAJA** — service layer cubierto, falta integration + e2e + scheduling. (Sprint 4 declarado). |

---

## 3. Cross-tenant gate matrix (HTTP layer)

Endpoints inventariados desde `src/modules/*/*.controller.ts` que requieren tenant-scoping:

| Endpoint | Test cross-tenant real | Estado |
|----------|------------------------|--------|
| `GET /v1/insureds` | — | `it.todo` |
| `GET /v1/insureds/:id` | — | `it.todo` |
| `GET /v1/insureds/:id/360` | parcial (e2e `insured-360.e2e-spec` valida 404 negativo cross-tenant) + RLS BD | **PARCIAL** |
| `PATCH /v1/insureds/:id` | — | `it.todo` |
| `DELETE /v1/insureds/:id` | — | `it.todo` |
| `POST /v1/insureds` | — | falta |
| `POST /v1/insureds/export` | — | falta (e2e está `describe.skip`) |
| `GET /v1/exports/:id` | — | falta |
| `GET /v1/batches` | — | falta |
| `GET /v1/batches/:id` | — | `it.todo` |
| `GET /v1/batches/:id/preview` | — | falta |
| `GET /v1/batches/:id/errors` | — | `it.todo` |
| `GET /v1/batches/:id/errors.xlsx` | — | falta |
| `POST /v1/batches/:id/confirm` | — | `it.todo` |
| `POST /v1/batches/:id/cancel` | — | falta |
| `POST /v1/batches` | — | falta |
| `GET /v1/certificates` | — | falta |
| `GET /v1/certificates/:id` | — | `it.todo` |
| `GET /v1/certificates/:id/url` | — | `it.todo` |
| `POST /v1/certificates/:id/reissue` | — | `it.todo` |
| `POST /v1/certificates/:id/resend-email` | — | falta |
| `GET /v1/certificates/:id/email-events` | — | falta |
| `GET /v1/certificates/mine` (portal) | — | falta |
| `GET /v1/claims/:id` | — | `it.todo` |
| `PATCH /v1/claims/:id` | — | `it.todo` |
| `POST /v1/claims` | — | falta |
| `GET /v1/packages/:id` | — | `it.todo` |
| `POST /v1/packages` / `PATCH` / `DELETE` | — | falta |
| `PATCH /v1/coverages/:id` | — | `it.todo` |
| `PUT /v1/coverages/:packageId` | — | falta |
| `GET /v1/audit/log` | — | `it.todo` |
| `GET /v1/audit/verify-chain` | — | falta |
| `GET /v1/chat/history` | — | `it.todo` |
| `GET /v1/chat/kb` | — | `it.todo` |
| `GET /v1/reports/dashboard` | — | falta (cubierto por `it.todo` `/v1/reports/*`) |
| `GET /v1/reports/conciliation` / `volumetry` / `usage` | — | falta |
| `GET /v1/users` / `POST` / `PATCH` / `DELETE` | — | falta |
| Tenant-override (S3-08): `admin_segurasist + X-Tenant-Override` | `tenant-override.e2e-spec.ts` (REAL, 7 it) + `it.todo` en security | **REAL** |

**Conteo**: ~38 endpoints HTTP tenant-scoped detectados. **Tests cross-tenant reales:
~2** (`tenant-override.e2e-spec.ts` cubre el flujo override; `insured-360.e2e-spec.ts`
cubre 404 negativo). El resto: 23 `it.todo` + ~13 sin siquiera placeholder. **Cobertura
real del gate HTTP ≈ 5% (2/38)**, gate BD (RLS) **100%** (5 tests reales).

---

## 4. Tests skipped/todo — inventario

### `describe.skip` / `test.skip`

| Archivo | Tipo | Razón documentada |
|---------|------|--------------------|
| `segurasist-api/test/e2e/certificates.e2e-spec.ts:38` | `describe.skip` (gated por `CERT_E2E=1`) | E2E pesado de pipeline PDF; sólo corre on-demand. |
| `segurasist-api/test/e2e/insureds-export.e2e-spec.ts:88` | `describe.skip` (todo el suite) | Sin razón visible — investigar si es un placeholder o regresión. |
| `segurasist-api/test/integration/cert-email-flow.spec.ts:56` | `describe.skip` condicional (`CERT_EMAIL_FLOW_E2E=1`) | Requiere infra (SES + Mailpit). |
| `segurasist-api/src/modules/auth/auth.service.spec.ts:95` | `describe.skip('otpRequest/otpVerify — implementadas, tests pendientes')` | Implementación lista, tests pendientes. **CRÍTICO**: bloquea cobertura RF-401. |
| `segurasist-web/tests/e2e/specs/portal-otp.spec.ts:32` | `test.skip` | "pendiente Sprint 3 — startInsuredOtp/verifyInsuredOtp" — no se desbloqueó. |
| `segurasist-web/tests/e2e/specs/portal-certificate.spec.ts:25` | `test.skip` | "pendiente Sprint 3" — no se desbloqueó. |

### `it.todo` (sólo en `cross-tenant.spec.ts`)
- 23 casos HTTP-layer (insureds 5, batches 3, certificates 3, claims 2, packages/coverages 2, audit 1, chat 2, reports 1, tenant-override 4).

---

## 5. Cobertura por capa (pirámide)

| Capa | Target QA-doc | Real (commit a8af110) | Gap |
|------|---------------|----------------------|-----|
| Unit | 60% | 538 BE + 417 web = 955 (~87% del total) | OK conteo, % real desconocido (sin `coverageThreshold`). Target QA `≥70% BE / ≥60% FE` no verificable estáticamente. |
| Integration | 25% | 12 archivos (`audit-mirror`, `batches-flow`, `cert-email-flow`, `dashboard-cache`, `insured-360`, `insureds-export`, `insureds-search-perf`, `object-lock-immutability`, `security-headers`, `tenant-override`, `throttler`, `verify-chain-cross-source`) → **estimado 130 tests** = ~12% | **bajo** (target 25%). |
| Cross-tenant | 5% | 7 reales (5 RLS BD + 2 HTTP) = ~0.6% sobre total | **gap** (23 todo). |
| E2E | 10% | 132 tests / 14 archivos BE + 3 archivos web (1 real, 2 skip) | OK conteo BE. Web E2E real = sólo `admin-login`. |
| Performance | obligatorio §6.1 | **0 scripts k6, 0 JMeter, lighthouserc.js existe pero CI no lo invoca** | **gap crítico**. |
| DAST | OWASP ZAP en CI | Configurado en `ci.yml` (raíz) + `.zap/rules.tsv` + `scripts/run-zap-baseline.sh` | OK config. |
| SAST | Semgrep | Configurado en `ci.yml` (api-security-scan + web-security-scan) | OK. |
| SCA | npm/pnpm audit `--audit-level=high` | Configurado | OK. |
| Container scan | Trivy | `aquasecurity/trivy-action@master` en `api-ci.yml` | OK (sólo backend). |

---

## 6. Comparación vs estándar industrial SaaS enterprise

| Métrica | MVP SegurAsist | Estándar | Gap |
|---------|----------------|----------|-----|
| Test count total | 1,094 | 2,000+ | bajo (S4 + chat/reports cerrarían parte) |
| Coverage backend | desconocido (collect ON, threshold OFF) | 70%+ | sin medición |
| Coverage frontend | desconocido | 60%+ | sin medición |
| E2E happy paths | 132 BE + 1 web real | 50+ web | OK BE, **gap web** |
| Cross-tenant HTTP gate | 2/38 endpoints | 100% | **gap crítico** |
| Performance baseline (k6) | 0 scripts | sí | **gap** |
| Lighthouse CI ejecutado | config existe, no corre | sí | gap |
| DAST en CI | configurado | ejecutado periódicamente | parcial |
| SAST en CI | Semgrep OK | OK | OK |
| Trivy container | sólo API | API + web image | parcial |

---

## 7. Recomendaciones Sprint 4 (top 5 acciones)

1. **Convertir 23 `it.todo` cross-tenant a tests reales** (`test/security/cross-tenant.spec.ts`).
   Stack listo: ya hay `superadmin-cross-tenant.e2e-spec.ts` como template. **Esfuerzo: 16-24h**.
2. **Desbloquear E2E portal asegurado** (`portal-otp.spec.ts`, `portal-certificate.spec.ts`):
   eliminar `test.skip`, levantar Mailpit en Playwright fixtures, probar flujo completo
   OTP → home → descarga PDF. **Esfuerzo: 12-16h**.
3. **Performance baseline k6**: crear `tests/perf/k6/` con 4 scripts según `MVP_07 §6.1`:
   `insureds-list-100vu.js`, `otp-1000vu-ramp.js`, `pdf-200rpm.js`, `dashboard-300vu-30min.js`.
   Integrar a `ci.yml` con job `nightly` (no por PR, son lentos). **Esfuerzo: 16-20h**.
4. **Activar Lighthouse CI**: existe `lighthouserc.js` en admin y portal pero ningún workflow
   los ejecuta — añadir step `treosh/lighthouse-ci-action` con budgets ≥85 admin / ≥90
   portal. **Esfuerzo: 4-6h**.
5. **Habilitar `coverageThreshold` en `jest.config.ts`** (`branches: 60, functions: 70,
   lines: 70`) y en `vitest.config` web (`60`). Esto convierte la métrica QA en **gate de
   PR** y evita regresiones. Levantar también el `describe.skip` de
   `auth.service.spec.ts:95` (otpRequest/otpVerify). **Esfuerzo: 6-10h** (incluye escribir
   los tests faltantes para alcanzar el umbral).

---

## 8. Estimación de esfuerzo total para llegar a estándar enterprise

| Acción | Horas |
|--------|-------|
| Cross-tenant HTTP gate 100% (23 todo + 13 endpoints sin placeholder) | 28-40h |
| Portal E2E (OTP + cert) + Mailpit fixtures | 12-16h |
| F5 chat + F6 reports avanzados (unit + integration + e2e) | 40-60h (S4 backlog) |
| Performance baseline (k6 + Lighthouse) | 20-26h |
| Coverage thresholds + tests faltantes para llegar a 70% BE / 60% FE | 24-40h |
| Trivy en imagen web + DAST scheduled (no sólo on-PR) | 4-6h |
| **TOTAL** | **128-188h** (~3-5 sprint-weeks de un QA senior dedicado) |

---

## 9. Anexos

**Archivos clave revisados** (paths absolutos):

- `/Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/segurasist-api/test/security/cross-tenant.spec.ts`
- `/Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/segurasist-api/test/e2e/` (14 archivos)
- `/Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/segurasist-api/test/integration/` (12 archivos)
- `/Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/segurasist-api/test/unit/modules/` (14 archivos)
- `/Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/segurasist-api/jest.config.ts`
- `/Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/segurasist-web/tests/e2e/specs/` (3 archivos, 2 skip)
- `/Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/.github/workflows/ci.yml`
- `/Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/segurasist-api/.github/workflows/api-ci.yml`
- `/Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/segurasist-web/.github/workflows/web-ci.yml`
- `/Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/.zap/rules.tsv`
- `/Users/ablz/Documents/Claude/Projects/SegurAsist/SaaS/scripts/run-zap-baseline.sh`
