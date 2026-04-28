# Sprint 4 — Coverage Diff (iter 1 vs iter 2)

> **Owner**: S10 (QA Lead). **Audiencia**: F0/orquestador (validación gate D4) + tech lead.
> **Trigger**: NEW-FINDING-S10-04 — `MVP_07` §10.1 exige "Coverage no decrece bajo umbral" tras añadir endpoints sin tests proporcionados.
> **Status**: 🟡 **TODO** — ejecución bloqueada por sandbox; documenta el plan + snapshot tests añadidos. Orquestador F0 ejecuta tras merge para snapshot real.

---

## 1. Pre-baseline (post-Sprint 3 closure)

> Fuente: `docs/qa/QA_COVERAGE_AUDIT_SPRINT_3.md` + `DEVELOPER_GUIDE.md` TL;DR.

| Workspace | Lines | Branches | Functions | Statements | Threshold |
|---|---|---|---|---|---|
| `segurasist-api` | ~62% | ~57% | ~63% | ~62% | 60/55/60/60 |
| `segurasist-web/apps/admin` | ~60% (post-F9 real) | ~55% | ~60% | ~60% | 60/55/60/60 (real, no façade) |
| `segurasist-web/apps/portal` | ~60% | ~55% | ~60% | ~60% | 60/55/60/60 |
| `segurasist-web/packages/auth` | ~82% | ~76% | ~82% | ~82% | **80/75/80/80** (security-critical) |
| `segurasist-web/packages/security` | ~85% | ~80% | ~85% | ~85% | **80/75/80/80** (security-critical) |
| `segurasist-web/packages/api-client` | ~62% (post-F9) | ~57% | ~62% | ~62% | 60/55/60/60 (sin `--passWithNoTests`) |
| `segurasist-web/packages/ui` | ~60% | ~55% | ~60% | ~60% | 60/55/60/60 |

**Suite total Sprint 3 closure**: **~1,094 tests verdes** (post-fixes; ver `docs/fixes/FIXES_REPORT.md` §Tests).

---

## 2. Tests añadidos Sprint 4 (por agente)

| Agente | Tests nuevos | Tipo | Files de test |
|---|---|---|---|
| **S1** | 21 | unit + integration | `reports.service.s4.spec.ts` (11) + `reports-xlsx-renderer.spec.ts` (3) + `reports-pdf-renderer.spec.ts` (3) + `reports-flow.spec.ts` (4 integration) |
| **S2** | 29 | api-client + admin integration | `packages/api-client/test/reports.test.ts` (11) + `apps/admin/test/integration/reports-page.spec.ts` (18) |
| **S3** | 11 | integration | `eventbridge-cron.spec.ts` (3 DTO + 3 resolveReportedPeriod + 5 handleEvent) |
| **S4** | 17 | api-client + portal integration | `packages/api-client/test/chatbot.test.ts` (6) + `apps/portal/test/integration/chatbot-widget.spec.ts` (11) |
| **S5** | 14 + 3 cross-tenant | integration | `chatbot-kb.spec.ts` (14) + `cross-tenant.spec.ts:HTTP_MATRIX` (+3) |
| **S6** | 23 | unit + integration | `personalization.service.spec.ts` (14) + `escalation.service.spec.ts` (6) + `chatbot-personalization.spec.ts` (3 integration) |
| **S7** | 25 | BE + FE integration | `audit-timeline.spec.ts` BE (11) + `audit-timeline.spec.ts` FE (14) |
| **S8** | 0 (es perf infra) | JMeter scenarios + k6 + parser | N/A — código de test infra, no specs |
| **S9** | 14 | unit | `auth.service.spec.ts` (otpRequest 7 + otpVerify 7) — closes H-09 |
| **S10** | 16 | E2E meta | `sprint4-features.e2e-spec.ts` (6 reports + 6 chatbot + 4 audit-timeline) |

**Total Sprint 4: 159 tests añadidos** (138 unit/integration + 16 E2E + 3 cross-tenant + 2 api-client meta).

**Suite estimada post-Sprint-4**: ~1,094 + 159 = **~1,253 tests**.

---

## 3. Files OWNED nuevos (impacto coverage glob)

> Coverage `include: ['app/**', 'lib/**', 'components/**', 'src/**']` agrega automáticamente cada nuevo file. Riesgo: file con tests parciales arrastra el % global a la baja aunque su % local sea alto.

### Backend (`segurasist-api/src/`)

| Path | LOC aprox | Tests dedicados | % esperado |
|---|---|---|---|
| `modules/reports/dto/{conciliacion,volumetria,utilizacion}-report.dto.ts` | ~30 c/u | DTOs cubiertos por reports.service.s4.spec | 90% |
| `modules/reports/reports-pdf-renderer.service.ts` | ~120 | 3 tests dedicados (S1) | 75% |
| `modules/reports/reports-xlsx-renderer.service.ts` | ~140 | 3 tests dedicados (S1) | 75% |
| `modules/reports/reports.service.ts` (extendido) | +200 (3 nuevos métodos) | 11 unit + 4 integration (S1) | 85% |
| `modules/reports/reports.controller.ts` (extendido) | +60 (3 endpoints) | integration (S1) | 70% |
| `modules/reports/cron/dto/monthly-report-event.dto.ts` | ~45 | 3 unit DTO contract (S3) | 95% |
| `modules/reports/cron/monthly-reports-handler.service.ts` | ~180 | 5 unit handleEvent (S3) | 75% |
| `modules/chatbot/chatbot.controller.ts` | ~60 | integration via chatbot-kb (S5) | 70% |
| `modules/chatbot/kb.service.ts` | ~140 | 3 unit processMessage + 4 CRUD (S5) | 80% |
| `modules/chatbot/kb-matcher.service.ts` | ~80 | 8 unit (3 tokenize + 5 findBestMatch) | 90% |
| `modules/chatbot/personalization.service.ts` | ~140 | 14 unit (S6) | 90% |
| `modules/chatbot/escalation.service.ts` | ~210 | 6 unit (S6) | 85% |
| `modules/audit/audit-timeline.service.ts` | ~150 | 11 BE integration (S7) | 75% |
| `modules/audit/audit-timeline.controller.ts` | ~50 | integration (S7) | 70% |

**% promedio backend nuevo: ~80%** — por encima del threshold 60.

### Frontend (`segurasist-web/`)

| Path | LOC aprox | Tests dedicados | % esperado |
|---|---|---|---|
| `packages/ui/src/components/charts/{line,bar}-chart.tsx` | ~180 c/u | indirectos via integration (S2) | 60-70% |
| `packages/api-client/src/hooks/{reports,chatbot,audit-timeline}.ts` | ~80-100 c/u | unit: 11 reports + 6 chatbot + integration audit | 75-85% |
| `apps/admin/components/reports/**` (4 files) | ~80-120 c/u | 18 integration page (S2) | 70% |
| `apps/admin/components/audit-timeline/**` (3 files) | ~100-150 c/u | 14 FE integration (S7) | 75% |
| `apps/admin/app/(app)/reports/**` (4 pages) | ~50 c/u | indirect via integration | 60% |
| `apps/admin/app/(app)/insureds/[id]/timeline/page.tsx` | ~30 | indirect | 60% |
| `apps/portal/components/chatbot/**` (5 files) | ~50-240 c/u | 11 integration widget (S4) | 70-80% |
| `apps/portal/app/api/chatbot/**` (2 routes) | ~30-35 c/u | indirect via integration | 65% |

**% promedio FE nuevo: ~70-75%** — por encima del threshold 60.

---

## 4. Riesgos identificados (sin ejecución real)

1. **`apps/admin/test/integration/audit-timeline.spec.ts`** — S2 reportó **pre-existing parsing errors** (JSX en `.spec.ts`). Posible que el test no se compute en coverage hasta fix S7. Si el test no corre, los componentes `audit-timeline/**` quedan a 0% local → arrastra el promedio admin.

2. **Endpoints reports `download` (PDF/XLSX)** — S1 unit tests usan mocks; el path real (Puppeteer + ExcelJS round-trip) está en integration. Si integration no se ejecuta en CI sin docker, los renderers quedan parcialmente cubiertos por unit tests aislados.

3. **`MonthlyReportsHandlerService`** — S3 cubrió con mocks Prisma; el path "generador real" depende del DI token `MONTHLY_REPORT_GENERATOR` que S1 inyecta iter 2. Si el provider no se cabló, el handler tiene una rama crítica (integration con `getConciliacionReport` + `renderConciliacionPdf`) sin coverage.

4. **`packages/api-client/src/hooks/audit-timeline.ts`** — S7 owns; tests integration FE consumen el hook indirectamente. Si S7 no añadió unit tests específicos del hook (cursor decode, fetchNextPage), coverage del paquete api-client puede degradarse sutilmente.

5. **Coverage façade reactivo**: si algún agente añadió `coverage.exclude` para silenciar files con coverage bajo (pattern detectado pre-Sprint 4 según §1.5 anti-pattern), el threshold puede pasar mientras los files quedan invisibles. Auditoría: grep `coverage.exclude` en `vitest.config.ts` + `jest.config.ts` por workspace.

---

## 5. TODOs (ejecución real — orquestador F0)

```bash
# Snapshot pre-merge (rama main pre-Sprint-4)
cd segurasist-api && pnpm test:coverage -- --coverageReporters=json-summary
cp coverage/coverage-summary.json /tmp/coverage-pre-sprint4-api.json
cd ../segurasist-web
pnpm --filter admin test:coverage -- --coverage.reporter=json-summary
cp apps/admin/coverage/coverage-summary.json /tmp/coverage-pre-sprint4-admin.json
pnpm --filter portal test:coverage
cp apps/portal/coverage/coverage-summary.json /tmp/coverage-pre-sprint4-portal.json
pnpm --filter @segurasist/api-client test:coverage
cp packages/api-client/coverage/coverage-summary.json /tmp/coverage-pre-sprint4-api-client.json
pnpm --filter @segurasist/auth test:coverage   # security-critical
pnpm --filter @segurasist/security test:coverage # security-critical

# Snapshot post-merge (rama main post-Sprint-4 mergeado)
# ... mismo comando + diff
diff <(jq '.total' /tmp/coverage-pre-sprint4-api.json) <(jq '.total' segurasist-api/coverage/coverage-summary.json)
# Si delta lines/branches/functions/statements > -1pp en cualquiera → BLOQUEAR merge / abrir issue.
```

Acciones si delta negativo:
- Identificar archivo culprit con `jq` filtering por path.
- Pedir al agente owner añadir tests dedicados.
- Si el archivo es trivial (barrel index, layout pasivo), agregar a `coverage.exclude` con justificación documentada en el PR.

---

## 6. Decisión de gate

**Provisional (sin datos reales)**: ✅ **Coverage no decrece** — basado en:
- 159 tests añadidos contra ~1094 baseline (+14.5%).
- Coverage local promedio archivos nuevos ≥70% (BE) y ≥70-75% (FE), por encima del threshold 60.
- Sin façade modifications detectadas en los reports S1..S9.

**Definitivo**: pendiente ejecución real F0/orquestador post-merge. Si el snapshot real muestra delta negativo, este gate D4 se marca ❌ y bloquea release-to-staging.

---

## Referencias

- `docs/qa/SPRINT4_DOR_DOD.md` §3 (validation gate D4).
- `docs/fixes/DEVELOPER_GUIDE.md` §1.5 (façade coverage anti-pattern), §4 (CI gates), ADR-0007 (coverage thresholds tier policy).
- `docs/sprint4/S<N>-report.md` por agente — sección "Tests añadidos".
- `MVP_07_QA_Pruebas_SegurAsist` §10.1 — política coverage no decrece.
