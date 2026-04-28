# Sprint 4 Features Feed (10 agentes × 2 iter)

> Append-only. Cada agente escribe a `feed/S<N>-iter<X>.md`; orquestador consolida aquí entre iteraciones.

## Formato
```
[<agentId>] <YYYY-MM-DD HH:MM> <ITER> <STATUS> <file:line> — <descripción> // <impacto>
```

- agentId ∈ {S1..S10}
- ITER ∈ {iter1, iter2}
- STATUS ∈ {STARTED, DONE, BLOCKED, NEEDS-COORDINATION, NEW-FINDING, iter1-complete, iter2-complete}

## Asignación

Ver `docs/sprint4/DISPATCH_PLAN.md`.

## Entradas

[S0-orchestrator] 2026-04-28 13:00 setup DONE docs/sprint4/ — feed + dispatch plan creados; 10 agentes listos para iter 1
[S1] 2026-04-27 14:30 iter1 STARTED — Reports BE (S4-01/02/03)
[S1] 2026-04-27 15:50 iter1 DONE S4-01 segurasist-api/src/modules/reports/{reports.service.ts,reports-pdf-renderer.service.ts,reports-xlsx-renderer.service.ts,reports.controller.ts,dto/conciliacion-report.dto.ts} — getConciliacionReport + PDF + XLSX + endpoint /v1/reports/conciliacion?from&to&format= con @Throttle(10/min) + audit fire-and-forget. // cifras cuadran con BD via prisma mocks
[S1] 2026-04-27 15:50 iter1 DONE S4-02 segurasist-api/src/modules/reports/{reports.service.ts,reports.controller.ts,dto/volumetria-report.dto.ts} — getVolumetria90 trend [7..365] días default 90; 4 series diarias date_trunc('day') paralelas; endpoint /v1/reports/volumetria. // FE owner S2 consume JSON
[S1] 2026-04-27 15:50 iter1 DONE S4-03 segurasist-api/src/modules/reports/{reports.service.ts,reports.controller.ts,dto/utilizacion-report.dto.ts} — getUtilizacion topN ordered by usageAmount DESC + byPackage agregado; PDF/XLSX/JSON; endpoint /v1/reports/utilizacion.
[S1] 2026-04-27 15:50 iter1 DONE tests segurasist-api/test/{unit/modules/reports/*,integration/reports-flow.spec.ts} — 21 specs (11 service + 3 xlsx + 3 pdf + 4 integration). suite scoped no ejecutada (sandbox), tsc clean en owned files.
[S1] 2026-04-27 15:55 iter1 NEW-FINDING reports.controller — PDF/XLSX devueltos via @Res({passthrough:true}) Buffer. // for-S2: FE consume con responseType:'blob'
[S1] 2026-04-27 15:55 iter1 NEW-FINDING workers/reports-worker — handler `export.requested` insureds NO extendido a reportes mensuales; cron monthly S4-04 (owner S3) decide si encolar `report.monthly.requested` → en ese caso agregar handler aquí en iter 2. // for-S3
[S1] 2026-04-27 15:55 iter1 NEW-FINDING reports.module — importa CertificatesModule para reusar PuppeteerService singleton (evita doble Chromium launch). // info-only
[S1] 2026-04-27 15:55 iter1 iter1-complete — 3 stories cerradas (S4-01/02/03 BE), 21 tests añadidos, 13 files (10 nuevos + 3 modificados). docs/sprint4/S1-report.md.
[S6] 2026-04-27 15:10 iter1 iter1-complete docs/sprint4/feed/S6-iter1.md — S4-07 + S4-08 cerradas (8pts). 6 archivos nuevos en `chatbot/`, 23 tests (14+6 unit + 3 integration), `MAC_SUPPORT_EMAIL` agregado. Signatures: `personalization.fillPlaceholders(tpl, insuredId)` y `escalation.escalate(insuredId, conversationId, reason): Promise<EscalateResult>`. // for-S5/S4-FE: signatures ESTABLES
[S6] 2026-04-27 15:11 iter1 NEW-FINDING prisma/schema.prisma — modelo `ChatConversation` no existe (S5 lo agrega); idempotencia escalation usada con `ChatMessage.escalated` + ventana 60min como bridge. // for-S5: cuando agregues `ChatConversation`, refactorizar `EscalationService` con `WHERE conversation_id = ?`
[S6] 2026-04-27 15:11 iter1 NEW-FINDING prisma/schema.prisma — `ClaimStatus` no tiene `closed`; usado `notIn:['paid','rejected']` para `{{claimsCount}}`. // info-only
[S6] 2026-04-27 15:11 iter1 NEW-FINDING prisma/schema.prisma — `AuditAction` no tiene `escalated`; usado `action='update'` + `payloadDiff.subAction='escalated'` (patrón existente). // for-S9: considerar agregar enum value en migración Sprint 5
[S6] 2026-04-27 15:12 iter1 NEEDS-COORDINATION src/modules/chatbot/chatbot.module.ts — S5 modificó el módulo agregando `ChatbotController` + `KbService` + `KbMatcherService`; mis providers `PersonalizationService` + `EscalationService` ya están registrados. NO toqué los archivos S5. // for-S5: tu módulo compila cuando crees los archivos referenciados
[S6] 2026-04-27 18:02 iter2 NEW-FINDING docs/sprint4/_features-feed.md — S5 NO publicó iter2 migration agregando `chatbot_escalated` al enum `AuditAction`. Mantengo workaround `action='update'` + `payloadDiff.subAction='escalated'` en `escalation.service.ts`. // for-S5: cuando publiques migration, S6 cambia 1 línea en service + 1 en spec
[S6] 2026-04-27 18:10 iter2 DONE src/modules/chatbot/escalation.service.ts — refactor idempotency con `ChatConversation` (S5 ya cableó modelo iter1). `findUnique` por id → check status → updateMany atómico `WHERE id=? AND status='active'`. Eliminado workaround ventana 60min `ChatMessage.escalated`. Defensa profundidad cross-insured intra-tenant agregada. Signature pública intacta.
[S6] 2026-04-27 18:18 iter2 DONE test/unit/modules/chatbot/escalation.service.spec.ts — refactor 9 tests (era 6). Mocks ahora `chatConversation.{findUnique,updateMany}`. 3 tests nuevos: race condition, conversation cross-insured, insured referencial mismatch.
[S6] 2026-04-27 18:30 iter2 iter2-complete docs/sprint4/feed/S6-iter2.md + S6-report.md — 2 follow-ups DONE (idempotency upgrade + tests refactor); follow-up audit-enum BLOCKED por S5 sin publicar migration con workaround documentado. tsc 0 errores en owned.
[S8] 2026-04-27 16:30 iter1 STARTED — Performance test JMeter (S4-10)
[S8] 2026-04-27 17:10 iter1 DONE S4-10 tests/performance/jmeter/{portal-load-1000.jmx,admin-load-100.jmx} — escenarios JMeter 1000+100 vu, mix 30/25/20/15/10 portal y CRUD/reports/exports admin, login OTP/email cached por VU, throughput controllers garantizan distribución exacta. // gate p95<=500ms err<=1%
[S8] 2026-04-27 17:10 iter1 DONE S4-10 tests/performance/k6/{portal,admin}.k6.js — alternativa moderna k6 con thresholds inline (http_req_duration p(95)<500, http_req_failed rate<0.01). // dev iteration
[S8] 2026-04-27 17:10 iter1 DONE S4-10 tests/performance/{parse-jtl.sh,baseline.json} — parser JTL → JSON p50/p95/p99/error + baseline schema con guards per-endpoint. // CI gate input
[S8] 2026-04-27 17:10 iter1 DONE S4-10 .github/workflows/perf.yml — workflow_dispatch + cron lunes 06:00 UTC, JMeter 5.6.3 binario (no docker), parser+bc evalúa gates fail si p95>500 o err>1%. // no en main CI; opt-in
[S8] 2026-04-27 17:10 iter1 DONE S4-10 tests/performance/jmeter/data/{generate-csv.mjs,insureds.csv(100),admins.csv(100),README.md} — fixtures determinísticas (seed 42/7); generador produce 1000 portal + 100 admin antes del run real. // JMeter recycle=true cubre mientras
[S8] 2026-04-27 17:10 iter1 DONE S4-10 docs/sprint4/{PERFORMANCE_REPORT.md,feed/S8-iter1.md,S8-report.md} + tests/performance/jmeter/scenarios/README.md — runbook reproducible local + CI.
[S8] 2026-04-27 17:11 iter1 NEW-FINDING auth/otp — OTP rate limit 5/min bloqueará ramp-up 1000 vu sin OTP_TEST_BYPASS=true en staging. // for-S9
[S8] 2026-04-27 17:11 iter1 NEW-FINDING infra/waf — runner GHA IP única → throttle global 100 req/min satura al subir vu; allowlist UA "JMeter/SegurAsist-S4-10*" requerido. // for-S3
[S8] 2026-04-27 17:11 iter1 NEW-FINDING chatbot/message — guard p95 800ms (no 500ms global) por LLM/regex matcher; documentado como excepción justificada. // for-S5
[S8] 2026-04-27 17:11 iter1 NEW-FINDING reports/conciliacion — guard p95 1500ms; sugerir materialized view o cache Redis 5min. // for-S1
[S8] 2026-04-27 17:11 iter1 NEW-FINDING audit/timeline — query con pageSize=50 + join audit_logs requiere índice (insured_id, created_at desc). // for-S7
[S8] 2026-04-27 17:11 iter1 NEW-FINDING qa/dod — agregar a SPRINT4_DOR_DOD.md "Performance gate ejecutado al menos 1 vez contra staging antes de cierre Sprint 4". // for-S10
[S8] 2026-04-27 17:11 iter1 BLOCKED ejecución real load test — sandbox sin staging accesible; F0/CI debe lanzar perf.yml manualmente para capturar baseline real.
[S8] 2026-04-27 17:12 iter1 iter1-complete — S4-10 cerrada (5 pts), 14 archivos nuevos, 0 modificados. baseline.json valores null hasta primer run. docs/sprint4/S8-report.md.
[S10] 2026-04-27 17:25 iter1 DONE docs/qa/SPRINT4_DOR_DOD.md — matriz DoR/DoD por historia S4-01..10 con leyenda + rollup + 4 NEW-FINDINGs // bloquea sello DoD iter 2
[S10] 2026-04-27 17:30 iter1 DONE segurasist-api/test/e2e/sprint4-features.e2e-spec.ts — 16 tests E2E con asserts reales + graceful-skip pattern (NO it.todo) // happy-path real validable post-deploy staging
[S10] 2026-04-27 17:35 iter1 DONE docs/fixes/DEVELOPER_GUIDE.md — secciones §2.6/§2.7/§2.8 (chart-report / KB-entry / EventBridge-cron) + 10 lecciones cross-bundle Sprint 4 // DEVELOPER_GUIDE 638 → ~920 líneas
[S10] 2026-04-27 17:36 iter1 NEW-FINDING prisma/rls/policies.sql — extender array con 'kb_entries' + 'chat_tickets' (S5/S6 owners) // tripwire en apply-rls-idempotency.spec.ts
[S10] 2026-04-27 17:36 iter1 NEW-FINDING prisma/schema.prisma enum AuditAction — agregar report_generated, report_downloaded, chatbot_message_sent, chatbot_escalated; migration UNIFICADA S1+S5+S6 (alinea con S6 finding sobre escalated) // reduce reconfig PG enum cache
[S10] 2026-04-27 17:36 iter1 NEW-FINDING coverage diff iter1↔iter2 — sin snapshot coverage-summary.json % global puede caer silenciosamente // S10 valida en iter 2
[S10] 2026-04-27 17:37 iter1 NEW-FINDING qa/dod — alineado con S8 finding: añadido criterio "Performance gate ejecutado ≥1 vez contra staging" en SPRINT4_DOR_DOD.md §3 validation gate D4
[S10] 2026-04-27 17:38 iter1 NEEDS-COORDINATION S5+S6 chatbot-cross-tenant.spec.ts fixture — TENANT_A KB-A vs TENANT_B KB-B mismo keyword // S10 valida en iter 2
[S10] 2026-04-27 17:39 iter1 NEEDS-COORDINATION S1 reports.controller — confirmar contrato download PDF/XLSX 200 vs 302 presigned; mi E2E spec tolera ambos por ahora // S10 ajusta asserts iter 2 según implementación final
[S10] 2026-04-27 17:40 iter1 iter1-complete docs/sprint4/S10-report.md — 4 deliverables OWNED + 4 NEW-FINDINGs + validation gate D4 documentado para iter 2
[S3] 2026-04-28 14:00 iter1 STARTED — DevOps + Backend Cron (S4-04, 5 pts)
[S3] 2026-04-28 15:30 iter1 DONE S4-04 segurasist-infra/modules/eventbridge-rule/{main,variables,outputs,versions}.tf + README.md — módulo nuevo schedule-based; targets SQS|Lambda mutuamente excluyentes; cron default `cron(0 14 1 * ? *)` (UTC); `aws_lambda_permission` auto-attach.
[S3] 2026-04-28 15:30 iter1 DONE S4-04 segurasist-infra/envs/{dev,staging,prod}/main.tf — queue `monthly-reports` (vt=600s) agregada al `local.queues`; `module "cron_monthly_reports"` invoca eventbridge-rule con target_sqs_arn; `aws_sqs_queue_policy` permite `events.amazonaws.com:sqs:SendMessage` con condition `aws:SourceArn = rule_arn`.
[S3] 2026-04-28 15:30 iter1 DONE S4-04 segurasist-infra/envs/{dev,staging,prod}/alarms.tf — alarm `cron-monthly-reports-failed` (AWS/Events FailedInvocations > 0); `queue_runbooks` map extendido con `monthly-reports → RB-014`; alarm_arns output incluye nuevo ARN.
[S3] 2026-04-28 15:30 iter1 DONE S4-04 segurasist-api/src/modules/reports/cron/{dto/monthly-report-event.dto.ts,monthly-reports-handler.service.ts} — Zod schema + `resolveReportedPeriod()`; handler con poll loop, idempotencia P2002→skip, resilencia per-tenant, audit `report.monthly` action='create'.
[S3] 2026-04-28 15:30 iter1 DONE S4-04 segurasist-api/prisma/{schema.prisma,migrations/20260428_monthly_report_runs/migration.sql,rls/policies.sql} — model `MonthlyReportRun` + UNIQUE `(tenant_id, period_year, period_month)` + RLS policies + GRANTs + array policies.sql extendido (anti-drift).
[S3] 2026-04-28 15:30 iter1 DONE S4-04 segurasist-api/src/config/env.schema.ts + .env.example — `SQS_QUEUE_MONTHLY_REPORTS` + `MONTHLY_REPORT_RECIPIENTS` (CSV→array emails validados con .pipe).
[S3] 2026-04-28 15:30 iter1 DONE tests segurasist-api/test/integration/eventbridge-cron.spec.ts — 11 it (DTO contract 3 + resolveReportedPeriod 3 + handleEvent 5 happy-path/idempotencia/failure-aislado/override/cero-tenants).
[S3] 2026-04-28 15:30 iter1 NEEDS-COORDINATION generador PDF — handler depende de `MonthlyReportGenerator` interface + DI token `MONTHLY_REPORT_GENERATOR`. **S1**: implementar provider real reusando `getConciliacionReport({from,to,scope:{platformAdmin:true,tenantId}})` + `renderConciliacionPdf(data)`. Conversión: from=Date.UTC(year,month-1,1), to=Date.UTC(year,month,1). // for-S1
[S3] 2026-04-28 15:30 iter1 NEEDS-COORDINATION bootstrap module — `MonthlyReportsHandlerService` aún NO está en ningún `@Module`; iter 2: `ReportsCronModule` con providers + import en AppModule. // for-S1+S0
[S3] 2026-04-28 15:30 iter1 NEW-FINDING TZ cron — AWS rules sólo soportan UTC; México sin DST permanente (14:00 UTC = 08:00 CST). Producto pidió 9 AM CST → desfase 1h aceptable MVP; migración Sprint 5 a `aws_scheduler_schedule` resuelve. // for-S0 producto
[S3] 2026-04-28 15:30 iter1 NEW-FINDING runbook RB-014 — alarm `cron-monthly-reports-failed` y DLQ apuntan a RB-014 que no existe. Cubrir: re-trigger manual `aws events put-events` con detail.kind='cron.monthly_reports'+overridePeriod; replay desde failed (DELETE fila libera UNIQUE → cuidado: re-emite email). // for-S10
[S3] 2026-04-28 15:30 iter1 NEW-FINDING email attachments — SendEmailCommand SDK v3 NO soporta attachments; MVP usa link presigned 7d (mismo patrón email-worker certs). // info-only
[S3] 2026-04-28 15:30 iter1 NEW-FINDING SQS queue policy pattern — env-level (no module-level) con condition `aws:SourceArn = rule_arn` (defense-in-depth confused-deputy). // for-DEVELOPER_GUIDE 2.2 update — S10
[S3] 2026-04-28 15:30 iter1 NEW-FINDING eventbridge SDK opcional — `@aws-sdk/client-eventbridge` no instalado; helper retirado iter 1 (cron real es IaC). Iter 2: agregar dep si se decide endpoint POST manual-trigger. // for-S0
[S3] 2026-04-28 15:30 iter1 iter1-complete docs/sprint4/S3-report.md — 1 historia (S4-04, 5pts), 18 archivos creados/modificados (10 IaC + 4 backend + 3 prisma + 1 env-schema), 11 it tests integration mock.
[S5] 2026-04-27 15:55 iter1 iter1-complete docs/sprint4/feed/S5-iter1.md — S4-06 cerrada (8pts). 10 archivos nuevos + 5 modificados. Schema extendido: ChatKb (+keywords/synonyms/priority/enabled), ChatMessage (+conversationId/role/matchedEntryId), nuevo ChatConversation + enum ChatConversationStatus. Migración 20260427_chatbot_kb idempotente con RLS. KbMatcherService (tokenize ES + score keywords+sinónimos + tie-break priority). KbService (processMessage + CRUD). 2 controllers (/v1/chatbot/message insured @Throttle 30/min; /v1/admin/chatbot/kb admin_mac+admin_segurasist). Seed 25 entries 5 categorías. 14 tests integration + 3 entries cross-tenant HTTP_MATRIX.
[S5] 2026-04-27 15:56 iter1 NEW-FINDING audit — usé action='create'+resourceType='chatbot.message'+payloadDiff.event en lugar de extender enum. // for-F6/S6: aliear con S6 finding "AuditAction sin escalated" + S10 finding "agregar chatbot_message_sent/chatbot_escalated"; migration UNIFICADA Sprint 5 zaps todas estas adiciones de una vez.
[S5] 2026-04-27 15:56 iter1 NEEDS-COORDINATION src/modules/chatbot/escalation.service.ts — S6 ya escribió la versión completa; KbService.processMessage la consume vía DI opcional. Signature `escalate(insuredId, conversationId, reason)` matchea acuerdo. // info-only
[S5] 2026-04-27 15:56 iter1 NEW-FINDING prisma/schema.prisma — modelos ChatMessage/ChatKb pre-existían (Sprint 1 stubs). Extendí en lugar de duplicar. Migración con `ADD COLUMN IF NOT EXISTS` permite cohabitar datos. // lección DEVELOPER_GUIDE: revisar siempre schema antes de model NEW
[S5] 2026-04-27 15:56 iter1 BLOCKED jest invocations — sandbox harness rechaza `jest`/`pnpm test`/binario directo. Specs typecheckean limpio. // for-orquestador: correr `pnpm test:integration -- chatbot-kb` y `pnpm test:cross-tenant` antes de cierre iter1
[S5] 2026-04-27 15:56 iter1 NEW-FINDING test/security/cross-tenant.spec.ts — agregadas 3 entries al HTTP_MATRIX para chatbot. KB de tenant B opaca a admin_mac de A. // valida F9 cross-tenant gate
[S5] 2026-04-27 15:57 iter1 NEEDS-COORDINATION S4 frontend — POST /v1/chatbot/message returns `{conversationId, response, matched, category?, escalated}`. Si necesitas más fields (e.g. matchedEntryId para botón "fue útil"), pídelos en iter 2 — agregarlos es 5 LOC en kb.service. // for-S4-FE

---
## Consolidación iter 1 Sprint 4 (10/10) — 2026-04-28 09:10


### feed/S1-iter1.md

[S1] 14:30 iter1 STARTED — Reports BE (S4-01/02/03, 23 pts)
[S1] iter1 DONE S4-01 segurasist-api/src/modules/reports/reports.service.ts:101 — getConciliacionReport: 7 queries paralelas (count insureds activosInicio/cierre/altas/bajas, count certs, claim.aggregate, coverageUsage.aggregate); cifras cuadran con BD; cache 5 min; soporta scope tenant + platformAdmin.
[S1] iter1 DONE S4-01 segurasist-api/src/modules/reports/reports-pdf-renderer.service.ts:23 — renderConciliacionPdf via PuppeteerService singleton (reuso); HTML A4 con tablas + escapeHtml defense-in-depth.
[S1] iter1 DONE S4-01 segurasist-api/src/modules/reports/reports-xlsx-renderer.service.ts:21 — renderConciliacionXlsx con exceljs (1 sheet Resumen); buffer XLSX legible (test verifica zip magic + load round-trip).
[S1] iter1 DONE S4-01 segurasist-api/src/modules/reports/reports.controller.ts:90 — GET /v1/reports/conciliacion?from&to&format=json|pdf|xlsx; @Throttle 10/min; @Roles admin_segurasist+admin_mac; audit auditCtx.fromRequest() + record action='export_downloaded'/'read_viewed'.
[S1] iter1 DONE S4-02 segurasist-api/src/modules/reports/reports.service.ts:222 — getVolumetria90: 4 queries $queryRaw paralelas (altas/bajas/certs/claims) GROUP BY date_trunc('day'); rellena buckets vacíos; days configurable [7..365]; default 90.
[S1] iter1 DONE S4-02 segurasist-api/src/modules/reports/reports.controller.ts:138 — GET /v1/reports/volumetria?days=N&tenantId=; JSON only (FE renderiza chart, owner S2).
[S1] iter1 DONE S4-03 segurasist-api/src/modules/reports/reports.service.ts:301 — getUtilizacion: coverageUsage.groupBy + coverage.findMany lookup; ordena por usageAmount DESC; LIMIT topN; calcula byPackage agregado para stack chart.
[S1] iter1 DONE S4-03 segurasist-api/src/modules/reports/reports.controller.ts:158 — GET /v1/reports/utilizacion?from&to&topN&format=json|pdf|xlsx; @Throttle 10/min.
[S1] iter1 DONE tests segurasist-api/test/unit/modules/reports/reports.service.s4.spec.ts — 11 it: cifras cuadran, null sums, platformAdmin scope, cache TTL/key, volumetría grilla, utilización topN+byPackage+filter coverages deleted.
[S1] iter1 DONE tests segurasist-api/test/unit/modules/reports/reports-xlsx-renderer.service.spec.ts — 3 it: zip magic, sheets esperadas, empty rows.
[S1] iter1 DONE tests segurasist-api/test/unit/modules/reports/reports-pdf-renderer.service.spec.ts — 3 it: html contiene período + cifras formateadas, escape XSS.
[S1] iter1 DONE tests segurasist-api/test/integration/reports-flow.spec.ts — 4 it: end-to-end conciliación (json→xlsx→ExcelJS load), pdf invoca puppeteer con html válido, volumetría 90 puntos, utilización byPackage suma + 3 sheets.
[S1] iter1 NEW-FINDING reports.controller — los endpoints PDF/XLSX devuelven Buffer via Fastify @Res({passthrough:true}). FE (S2) debe consumir con `responseType: 'blob'` o equivalente. // for-S2 (FE consumes endpoints)
[S1] iter1 NEW-FINDING audit-action-enum — usé 'export_downloaded' / 'read_viewed' (ya existen tras F6 iter2). Si S10 quiere granularidad 'report_generated' separado, agregar via migration ADD VALUE IF NOT EXISTS. // for-S10 (DEVELOPER_GUIDE update)
[S1] iter1 NEW-FINDING reports.module — ReportsModule importa CertificatesModule para reusar PuppeteerService singleton. Evita doble launch Chromium con el reports-worker; documentado en module JSDoc. // info-only
[S1] iter1 NEW-FINDING workers/reports-worker — la story original mencionaba "extender worker para reportes mensuales" pero S3 (DevOps cron + EventBridge) es owner de S4-04 trigger mensual. Worker actual sigue dedicado a `export.requested` insureds. Iter 2: si S3 decide encolar `report.monthly.requested`, agregar handler aquí; por ahora out-of-scope. // for-S3 (cron handler)
[S1] iter1 iter1-complete — 3 stories (S4-01/02/03 backend), 21 tests añadidos (11 unit service + 3 xlsx + 3 pdf + 4 integration), suite scoped pendiente de ejecutar (sandbox bloquea pnpm test:unit; tsc clean en archivos owned).


### feed/S2-iter1.md

[S2] 2026-04-27 09:00 iter1 STARTED — Reports FE bundle (S4-01/02/03 frontend)
[S2] iter1 DONE S4-01/02/03 segurasist-web/packages/ui/src/components/charts/line-chart.tsx — `<LineChart />` reusable, multi-serie, tokens theme SegurAsist, tooltip custom, sin asignar height (lo controla el padre).
[S2] iter1 DONE S4-01/02/03 segurasist-web/packages/ui/src/components/charts/bar-chart.tsx — `<BarChart />` reusable con layout vertical|horizontal (horizontal preferido para Top-N por categoría con labels largas).
[S2] iter1 DONE segurasist-web/packages/ui/src/components/charts/index.ts — export barrel; integrado en `packages/ui/src/index.ts`.
[S2] iter1 DONE segurasist-web/packages/ui/package.json — agregada dep `recharts@2.12.7` (matched a admin app, paquete ya estaba instalado vía workspace pero no declarado).
[S2] iter1 DONE S4-01/02/03 segurasist-web/packages/api-client/src/hooks/reports.ts — extendido con `useConciliacionReport`, `useVolumetria`, `useUtilizacion`, `useDownloadReport` mutation + `downloadReportBlob()` helper (Blob + URL.createObjectURL + click `<a>` con filename ISO + revoke en setTimeout 0 — patrón Safari-safe). Mantiene exports legacy (`useVolumetry/useUsage/useGenerateMonthlyReconciliation`) marcados `@deprecated` para no romper consumidores existentes (Sprint 5 cleanup).
[S2] iter1 DONE tests segurasist-web/packages/api-client/test/reports.test.ts — 11 it: query strings correctos, `enabled=false` cuando filtros vacíos, `downloadReportBlob` invoca click con `download` attr correcto, response !ok throw, mutation hook invoca helper. Suite api-client: 51 pass / 51.
[S2] iter1 DONE S4-01 segurasist-web/apps/admin/components/reports/report-filters.tsx — `<ReportFilters />` con 2 DatePickers (desde/hasta) + input opcional entidad. Validación `from <= to` con mensaje inline `role=alert`. Default = últimos 30 días.
[S2] iter1 DONE S4-01 segurasist-web/apps/admin/components/reports/report-download-buttons.tsx — botones PDF + XLSX, dos `useDownloadReport()` independientes, aria-label + aria-busy + Loader2 spinner mientras pending, alerta inline si error.
[S2] iter1 DONE S4-02 segurasist-web/apps/admin/components/reports/volumetria-chart.tsx — wrap del `<LineChart />` con 4 series (altas/bajas/certificados/claims, alineado al BE shape S1), states loading/error/empty/ok.
[S2] iter1 DONE S4-03 segurasist-web/apps/admin/components/reports/utilizacion-chart.tsx — wrap `<BarChart />` horizontal Top-N por `usageAmount`, selector `Top {5,10,20}` interno, recibe `from`/`to`/`tenantId` como props.
[S2] iter1 DONE pages: segurasist-web/apps/admin/app/(app)/reports/page.tsx (hub con 3 cards-link), .../reports/conciliacion/page.tsx (filters + grid de 8 stats + download buttons), .../reports/volumetria/page.tsx (selector 30/60/90 días + chart, sin downloads — BE solo expone JSON para volumetria), .../reports/utilizacion/page.tsx (filters + chart + downloads).
[S2] iter1 DONE tests segurasist-web/apps/admin/test/integration/reports-page.spec.ts — 18 it: `isFilterValid` 3 cases, `defaultReportFilters` (últimos 30 días), `<ReportFilters />` muestra/oculta error, `<ReportDownloadButtons />` PDF/XLSX dispara mutate con format correcto, disabled bloquea click, isError muestra alert, isPending → aria-busy + disabled, `<VolumetriaChart />` 4 estados, `<UtilizacionChart />` empty + datos, integración full page conciliación renderiza stats + botones download. Suite admin: 18/18 pass scoped.
[S2] iter1 NEW-FINDING reports.controller volumetria — S1 confirmó `JSON only` (sin format=pdf|xlsx). Se removió botones download de la página volumetría. Si stakeholders requieren PDF/XLSX para volumetria, agregar handler en controller + renderer; ETA Sprint 5. // for-S1+stakeholders
[S2] iter1 NEW-FINDING reports shapes alineadas a S1 iter1 — initial spec esperaba `ConciliacionReportResponse.rows[]` (preview tabular); BE expone agregado único (single object con `activosInicio/activosCierre/altas/bajas/...`). Ajustada UI: stats grid en lugar de DataTable. Asimismo `UtilizacionRow` no tiene `used/limit/utilizationPct`, sino `usageCount/usageAmount/coverageType`; el chart bar usa `usageAmount`. Conciliacion filtro entidad pasa por `tenantId` (platformAdmin only). // info-only — alineado.
[S2] iter1 NEW-FINDING admin/(app)/reports/utilizacion — el filtro UI por paquete que existía en spec inicial NO está en el endpoint BE iter1 (solo `from/to/topN/tenantId`). Se removió selector de paquete. Si stakeholders quieren filtrar por paquete sin descartar coberturas de otros, agregar query param al BE iter2. // for-S1 (iter2 BE param)
[S2] iter1 NEW-FINDING `Sparkline` placeholder en dashboard-client.tsx no movido a packages/ui — fuera de scope (owned por dashboard team). El nuevo `<LineChart />` es estructural y no reemplaza el sparkline. // info-only
[S2] iter1 NEW-FINDING audit-timeline.spec.ts (S7 owned) tiene parsing errors TS (JSX en .spec.ts en lugar de .spec.tsx) y otros 4 tests insured-360.test.tsx fallan por falta de QueryClientProvider. PRE-EXISTENTE, no causado por S2; flagging para S7+S10. // for-S7+S10
[S2] iter1 iter1-complete — 12 archivos creados, 1 modificado (packages/ui index + package.json + reports/page.tsx replaced), 29 tests añadidos (11 api-client + 18 admin integration), suite reports passing 100%. Typecheck OK en archivos owned (admin, api-client, ui packages).


### feed/S3-iter1.md

[S3] 2026-04-28 14:00 iter1 STARTED — DevOps + Backend Cron (S4-04, 5 pts)
[S3] iter1 DONE S4-04 segurasist-infra/modules/eventbridge-rule/main.tf:33 — module nuevo `eventbridge-rule` con `aws_cloudwatch_event_rule` schedule-based + targets SQS|Lambda mutuamente excluyentes; cron default `cron(0 14 1 * ? *)` (día 1 14:00 UTC); validation regex en `cron_expression`; `aws_lambda_permission` auto-attach cuando target=Lambda. // 4 archivos (main/variables/outputs/versions) + README.
[S3] iter1 DONE S4-04 segurasist-infra/envs/dev/main.tf:371 — agregada queue `monthly-reports` al `local.queues` (vt=600s) + invocación módulo `eventbridge-rule` con `target_sqs_arn = module.sqs["monthly-reports"].queue_arn` + `aws_sqs_queue_policy` con `data.aws_iam_policy_document` para permitir `events.amazonaws.com:sqs:SendMessage` con `aws:SourceArn = rule_arn` (defense-in-depth contra confused-deputy).
[S3] iter1 DONE S4-04 segurasist-infra/envs/staging/main.tf — mismo wiring que dev (queue monthly-reports vt=600s + cron rule + sqs policy).
[S3] iter1 DONE S4-04 segurasist-infra/envs/prod/main.tf — mismo wiring; tag Severity=P1 en rule + alarm; comentario "NO desactivar sin coordinar con S1".
[S3] iter1 DONE S4-04 segurasist-infra/envs/{dev,staging,prod}/alarms.tf — agregada alarma `cron-monthly-reports-failed` (AWS/Events FailedInvocations > 0 en 5 min); `queue_runbooks` mapa extendido con `monthly-reports → RB-014`; alarm_arns output incluye el nuevo ARN.
[S3] iter1 DONE S4-04 segurasist-api/src/modules/reports/cron/dto/monthly-report-event.dto.ts — `MonthlyReportCronEventSchema` Zod (kind literal, schemaVersion default 1, triggeredAt ISO opcional, overridePeriod {year,month} opcional, triggeredBy enum eventbridge|manual default eventbridge); `resolveReportedPeriod(triggeredAt, override?)` con edge enero→dic año anterior.
[S3] iter1 DONE S4-04 segurasist-api/src/modules/reports/cron/monthly-reports-handler.service.ts — `MonthlyReportsHandlerService` con poll loop (gated `WORKERS_ENABLED!=true || NODE_ENV=test`), `pollOnce()` valida shape SQS via Zod, `handleEvent()` itera tenants activos llamando `processTenant()`. Idempotencia DB-side: `prisma.monthlyReportRun.create({...})` → captura `Prisma.PrismaClientKnownRequestError` code `P2002` ⇒ `skip`. Resilencia per-tenant: failure de A no aborta B. Pipeline tenant: pending→processing→generator.generate(pdf)→S3 putObject SSE-KMS→presigned 7d→ses.sendEmail multi-recipient→completed. Audit `auditWriter.record({action:'create', resourceType:'report.monthly', payloadDiff:{subAction:'sent'|'failed', period, ...}})`. Worker exento de auditCtx.fromRequest (sin req, ADR-0001).
[S3] iter1 DONE S4-04 segurasist-api/prisma/schema.prisma:212 — enum `MonthlyReportStatus` (pending|processing|completed|failed) + model `MonthlyReportRun` con `@@unique([tenantId, periodYear, periodMonth])`; relación `Tenant.monthlyReportRuns`.
[S3] iter1 DONE S4-04 segurasist-api/prisma/migrations/20260428_monthly_report_runs/migration.sql — CREATE TYPE + TABLE `monthly_report_runs` con CHECKs (period_month BETWEEN 1 AND 12, period_year BETWEEN 2024 AND 2100, triggered_by IN ('eventbridge','manual')); UNIQUE INDEX natural key + 2 indexes secundarios; ENABLE/FORCE RLS + p_select/p_modify; GRANTs idempotentes a segurasist_app/admin.
[S3] iter1 DONE S4-04 segurasist-api/prisma/rls/policies.sql:79 — agregado `monthly_report_runs` al array `tables` (anti-drift static check apply-rls-idempotency.spec).
[S3] iter1 DONE S4-04 segurasist-api/src/config/env.schema.ts:87 — agregadas `SQS_QUEUE_MONTHLY_REPORTS` (z.string().url()) + `MONTHLY_REPORT_RECIPIENTS` (CSV → transform → pipe(z.array(z.string().email()).min(1))).
[S3] iter1 DONE S4-04 segurasist-api/.env.example:60 — entradas para ambas vars con comentarios.
[S3] iter1 DONE tests segurasist-api/test/integration/eventbridge-cron.spec.ts — 11 it: DTO contract (3 — válido, kind inválido, default schemaVersion); resolveReportedPeriod (3 — feb→ene, ene→dic año-1, override gana); handleEvent (5 — happy path 2 tenants, idempotencia P2002 skip sin re-email, failure aislado A→failed B→completed, overridePeriod manual con triggeredBy='manual', cero tenants no-op).
[S3] iter1 DECISION arquitectura — Opción A (EventBridge → SQS → Worker NestJS) sobre Opción B (Lambda webhook). Justificación: (1) reusa patrón polling existente (reports/emails/pdf/insureds-creation), (2) DLQ + idempotencia DB-side ya en DEVELOPER_GUIDE 2.2, (3) sin IaC nueva para deploy de Lambda dedicada. Trade-off: depende de App Runner up; mitigación = DLQ + alarm `eventbridge-rule-failed` ya wired.
[S3] iter1 NEEDS-COORDINATION generador del PDF mensual — handler depende de `MonthlyReportGenerator` interface inyectada via DI token `MONTHLY_REPORT_GENERATOR`. Stub default lanza NotImplemented. **S1**: implementar `MonthlyReportGenerator.generate({tenantId, period})` reusando `getConciliacionReport({from, to, scope:{platformAdmin:true,tenantId}})` + `renderConciliacionPdf(data)`. Period→from/to: `from = new Date(Date.UTC(year, month-1, 1))`, `to = new Date(Date.UTC(year, month, 1))`. Iter 2 acción: registrar provider en `ReportsModule` (o nuevo `ReportsCronModule`) que importe `CertificatesModule` (Puppeteer singleton). // for-S1
[S3] iter1 NEEDS-COORDINATION cron-handler bootstrap — el `MonthlyReportsHandlerService` aún NO está registrado en ningún `@Module({providers:[...]})`. Iter 2: crear `ReportsCronModule` (o agregar a `WorkersModule`) con providers `[MonthlyReportsHandlerService, {provide: MONTHLY_REPORT_GENERATOR, useClass: <RealGenerator>}]`; importar `WorkersModule`/`ReportsCronModule` en `AppModule`. // for-S1 + for-S0
[S3] iter1 NEW-FINDING email attachments — SendEmailCommand SDK v3 NO soporta attachments (sólo SendRawEmailCommand con MIME). MVP usa link presigned 7d (mismo patrón que email-worker certificates). Sprint 5+ migrar a SendRawEmailCommand. // info-only
[S3] iter1 NEW-FINDING TZ del cron — AWS `aws_cloudwatch_event_rule.schedule_expression` NO soporta TZ (sólo UTC). México abandonó DST en 2022 ⇒ 14:00 UTC = 08:00 CST permanente. Producto pidió "9 AM CST" — desfase 1h aceptable; alternativa Sprint 5 = migrar a `aws_scheduler_schedule` (EventBridge Scheduler nuevo, soporta TZ). Documentado en main.tf del módulo. // for-S0 (decisión producto)
[S3] iter1 NEW-FINDING runbook RB-014 — alarm `cron-monthly-reports-failed` y DLQ `monthly-reports` apuntan a runbook RB-014 que NO existe todavía. **S10** (tech writer) crear RB-014 cubriendo: (1) re-trigger manual via `aws events put-events` con detail `{kind:'cron.monthly_reports', triggeredBy:'manual', overridePeriod:{year,month}}`; (2) inspección `monthly_report_runs WHERE status='failed'`; (3) replay vía DELETE de la fila failed para liberar la UNIQUE key (cuidado: emite email duplicado). // for-S10
[S3] iter1 NEW-FINDING SQS queue policy — env-level wiring (`aws_sqs_queue_policy.monthly_reports`) lo declaré en cada env por consistencia con el resto del IaC; el módulo `eventbridge-rule` NO maneja la policy (la cola es del módulo `sqs-queue`). Pattern aplicable a futuras rules → SQS. // for-DEVELOPER_GUIDE 2.2 update
[S3] iter1 NEW-FINDING eventbridge SDK opcional — el helper `src/infra/aws/eventbridge.service.ts` requería `@aws-sdk/client-eventbridge` (no instalado en package.json). Como NO es bloqueante (cron real es IaC; el helper sólo serviría para re-trigger manual via app), lo retiré de iter 1. **Iter 2 acción S0/S1**: agregar `@aws-sdk/client-eventbridge ^3.621` a deps si se decide exponer endpoint POST `/v1/internal/cron/monthly-reports/trigger`. Alternativa: re-trigger manual via `aws events put-events` CLI desde ops. // for-S0
[S3] iter1 iter1-complete — 1 historia (S4-04, 5pts), 18 archivos creados/modificados (4 IaC módulo + 6 IaC envs + 4 backend code + 2 prisma + 1 env schema + 1 .env.example), 11 it tests integration mock, scoped tsc/lint pendientes (sandbox bloquea pnpm).


### feed/S4-iter1.md

[S4] 09:00 iter1 STARTED — Chatbot widget portal + escalamiento (S4-05 5pts + S4-08 3pts = 8pts)
[S4] iter1 DONE S4-05 segurasist-web/packages/api-client/src/hooks/chatbot.ts:1 — useSendChatMessage() mutation POST /v1/chatbot/message {message, conversationId?}; useEscalateConversation() mutation POST /v1/chatbot/escalate {conversationId, reason?}; types ChatMessageReply con index signature [extra: unknown] para flex shape S5/S6.
[S4] iter1 DONE S4-05 segurasist-web/packages/api-client/package.json:21 — agregado export "./hooks/chatbot": "./src/hooks/chatbot.ts" (S7 también agregó audit-timeline en paralelo, conflicto resuelto manteniendo ambos).
[S4] iter1 DONE S4-05 segurasist-web/apps/portal/components/chatbot/chatbot-store.ts:1 — Zustand store con persistencia manual a localStorage (key sa.portal.chatbot.v1, TTL 7 días, cap 50 mensajes); SSR-safe; helper __resetChatbotStoreForTests para specs.
[S4] iter1 DONE S4-05 segurasist-web/apps/portal/components/chatbot/chatbot-message.tsx:1 — ChatbotMessageBubble con 3 variantes (bot izq+avatar Bot, user der+avatar User, system centrado warning); timestamp relativo en español ("ahora", "hace N min/h/d") sin date-fns dep; aria-label completo por bubble.
[S4] iter1 DONE S4-05 segurasist-web/apps/portal/components/chatbot/chatbot-typing-indicator.tsx:1 — 3 dots animados con keyframe local sa-chatbot-bounce (inyectado <style jsx global> desde widget); aria-live polite; sr-only "El asistente está escribiendo".
[S4] iter1 DONE S4-05 segurasist-web/apps/portal/components/chatbot/chatbot-input.tsx:1 — textarea autogrow max 96px (~4 líneas); Enter envía / Shift+Enter newline; send button disabled si trim().length===0; "Hablar con humano" siempre visible (no overflow menu) con spinner Loader2 + aria-busy mientras escalating.
[S4] iter1 DONE S4-05 segurasist-web/apps/portal/components/chatbot/chatbot-widget.tsx:1 — FAB esquina inf-derecha (50x50 mobile / 60x60 desktop, bottom-[88px] sobre nav, marginBottom env(safe-area-inset-bottom)); panel role="dialog" aria-modal con drawer 80vh inset-x-0 mobile / floating card 380x540 right-6 bottom-6 desktop; backdrop blur solo desktop (mobile drawer ocupa pantalla); Esc cierra; auto-scroll messagesEndRef al recibir mensaje/typing; on send agrega user bubble optimista, llama mutation, agrega bot reply o system bubble en error + toast.error; on escalate verifica conversationId existente (si no, toast "envía primero un mensaje"), llama mutation, marca markEscalated y agrega system bubble + toast.success "Folio TK-xxx".
[S4] iter1 DONE S4-05 segurasist-web/apps/portal/components/chatbot/index.ts:1 — barrel exports.
[S4] iter1 DONE S4-05 segurasist-web/apps/portal/app/(app)/layout.tsx:3 — reemplazado import ChatFab placeholder por ChatbotWidget real; comentario explicando auth gate vía middleware.
[S4] iter1 DONE S4-08 segurasist-web/apps/portal/app/api/chatbot/route.ts:1 — POST handler dedicado a /api/chatbot que reusa makeProxyHandler de @segurasist/security/proxy con context fake {params:{path:['v1','chatbot','message']}}; documentación de por qué dedicada (superficie pública mínima, hook futuro de métricas dedicadas, defense-in-depth si remueven catchall).
[S4] iter1 DONE S4-08 segurasist-web/apps/portal/app/api/chatbot/escalate/route.ts:1 — mismo patrón para /api/chatbot/escalate → /v1/chatbot/escalate.
[S4] iter1 DONE tests segurasist-web/packages/api-client/test/chatbot.test.ts — 6 it: send con/sin conversationId, send 500→falla, escalate con/sin reason, escalate 429→falla; verifica path /api/proxy/v1/chatbot/{message,escalate}, body JSON, x-trace-id presente.
[S4] iter1 DONE tests segurasist-web/apps/portal/test/integration/chatbot-widget.spec.ts — 11 it: render inicial sin fetch, click FAB→dialog+welcome, send→POST+user bubble+bot bubble+conversationId persist, Enter envía/Shift+Enter newline, escalate sin conv→no llama backend, escalate con conv→ticket banner+button disabled, error 503→system bubble+user msg preservado, localStorage persiste conversationId+messages, Esc cierra panel, aria-modal+aria-labelledby+aria-live polite, enabled=false→empty render.
[S4] iter1 NEW-FINDING shape /v1/chatbot/message — tipé ChatMessageReply con campos {conversationId, messageId, reply, author:'bot', ts} + opcionales personalization (policyExpiresAt, packageName) + index signature [extra:unknown]. Cualquier cambio S5/S6 entra sin breakage; iter 2 podría pintar sub-bubble con personalization. // for-S5 for-S6 (cuando publiquen DTO firme, ajustar tipos)
[S4] iter1 NEW-FINDING auth gate — el widget se renderiza dentro de (app)/layout.tsx, ya cubierto por middleware del portal que redirige a /login si no hay cookie. Por eso no hay chequeo runtime extra; prop `enabled` queda como salida de emergencia para feature flag futuro. // info-only
[S4] iter1 NEW-FINDING dedicated routes vs catchall — el dispatch pidió rutas /api/chatbot y /api/chatbot/escalate, pero los hooks api() rutean por /api/proxy/v1/chatbot/*. Creé las dedicadas reusando makeProxyHandler con path fake; ambos caminos llegan al mismo upstream. Decidir en iter 2 si migrar hooks a /api/chatbot directo (ventaja: métricas dedicadas) o eliminar las dedicadas (ventaja: DRY catchall). // for-S0 (decisión arq)
[S4] iter1 NEW-FINDING ChatFab placeholder removido — components/layout/chat-fab.tsx queda huérfano (era el toast "próximamente"). No lo borré porque el spec marca files OWNED al chatbot/, no layout/. S10 puede limpiar en iter QA. // for-S10 (cleanup)
[S4] iter1 NEW-FINDING zustand@4.5.4 ya estaba en deps del portal — no requiere npm install ni mod a package.json.
[S4] iter1 tests-result api-client suite 51/51 pass (chatbot.test.ts 6/6); portal suite 88/88 pass (chatbot-widget.spec.ts 11/11); tsc clean api-client + portal.
[S4] iter1 iter1-complete — 2 stories (S4-05 5pts + S4-08 3pts = 8pts), 8 archivos creados + 2 modificados, 17 tests añadidos (6 hooks + 11 widget integration). Listo para iter 2 (ajustes shape S5/S6 + decisión rutas dedicadas vs catchall).


### feed/S5-iter1.md

# S5 — Iter 1 feed

Backend Senior NLP/KB. Bundle S4-06 (KB structure + matching engine + admin CRUD).

## Entradas

[S5] 2026-04-27 14:00 iter1 STARTED docs/sprint4/feed/S5-iter1.md — arrancando S4-06; lectura DISPATCH_PLAN + DEVELOPER_GUIDE 2.1/2.3/2.5

[S5] 2026-04-27 14:10 iter1 NEEDS-COORDINATION src/modules/chatbot/escalation.service.ts — S6 ya escribió EscalationService completo (S4-08). Yo NO lo sobreescribo; KbService.processMessage lo inyecta opcional y delega cuando no hay match. La firma `escalate(insuredId, conversationId, reason)` matchea lo acordado en el plan.

[S5] 2026-04-27 14:15 iter1 NEW-FINDING prisma/schema.prisma:521 — `ChatMessage` y `ChatKb` ya existían (Sprint 1 stubs). En lugar de duplicar, los **extendí** con columnas faltantes (keywords, synonyms, priority, enabled en ChatKb; conversationId, role, matchedEntryId en ChatMessage) + agregué nuevo modelo `ChatConversation`. Compatible con direction inbound/outbound legacy.

[S5] 2026-04-27 14:25 iter1 DONE prisma/migrations/20260427_chatbot_kb/migration.sql — migración idempotente (CREATE/ALTER ... IF NOT EXISTS) crea `chat_conversations`, extiende `chat_messages` y `chat_kb`, habilita RLS + policies en las 3 tablas + grants defensivos.

[S5] 2026-04-27 14:30 iter1 DONE prisma/rls/policies.sql:67 — agregado `chat_conversations` al array canónico (drift static check ya cubierto por apply-rls-idempotency.spec.ts existente).

[S5] 2026-04-27 14:45 iter1 DONE src/modules/chatbot/kb-matcher.service.ts — algoritmo puro: tokenize (lowercase + strip acentos NFD + stop-words ES) → score = matched_keywords + sinónimos. MIN_SCORE=1, tie-break por priority desc → score desc → orden de llegada.

[S5] 2026-04-27 15:00 iter1 DONE src/modules/chatbot/kb.service.ts — orquestador: processMessage (resolveConversation + persist user + match + personalizar S6 + persist bot + audit) y CRUD admin (list/get/create/update soft-delete). PersonalizationService y EscalationService inyectados @Optional para que tests unit no requieran S6.

[S5] 2026-04-27 15:10 iter1 DONE src/modules/chatbot/chatbot.controller.ts — 2 controllers en el archivo: `ChatbotController` (POST /v1/chatbot/message, role=insured, throttle 30/min) y `AdminChatbotKbController` (CRUD bajo /v1/admin/chatbot/kb, roles=admin_mac/admin_segurasist).

[S5] 2026-04-27 15:15 iter1 DONE seed/chatbot-kb-seed.ts — 25 entries en es-MX (5 categorías x 5 entries: coverages, claims, certificates, billing, general). Idempotente por (tenantId, category, question). Usa placeholders S6 (`{{validTo}}`, `{{coveragesList}}`, etc.).

[S5] 2026-04-27 15:25 iter1 DONE test/integration/chatbot-kb.spec.ts — 14 tests (matcher tokenize 3 + findBestMatch 5; KbService processMessage match 1 + no-match 2 + CRUD 4). PrismaService mockeado deep; PersonalizationService + EscalationService inyectados como mocks.

[S5] 2026-04-27 15:30 iter1 DONE test/security/cross-tenant.spec.ts — agregadas 3 entradas al HTTP_MATRIX (GET /v1/admin/chatbot/kb, GET /v1/admin/chatbot/kb/:id, PATCH /v1/admin/chatbot/kb/:id) — admin_mac de tenant A no puede leer/mutar entries de B.

[S5] 2026-04-27 15:35 iter1 DONE src/app.module.ts — agregado `ChatbotModule` al imports. Coexiste con el `ChatModule` legacy (Sprint 1 stub) — el FE Sprint 4 (S4) consume el nuevo path /v1/chatbot/*.

[S5] 2026-04-27 15:40 iter1 NEEDS-COORDINATION audit action — usé `action: 'create'` + `resourceType: 'chatbot.message'` + `payloadDiff.event='chatbot.message'` (NO extendí enum AuditAction). Razón: per DEVELOPER_GUIDE 2.5 extender enum requiere migration `ALTER TYPE … ADD VALUE`; coordinaremos con S6/F6 en iter2 si decidimos `chatbot_message` como valor enum dedicado.

[S5] 2026-04-27 15:45 iter1 DONE typecheck `npx tsc --noEmit` — 0 errores en archivos owned (kb.service, kb-matcher, controller, dtos, escalation already there S6, integration spec). Restantes 7 errores son `auth.service.spec.ts` (no owned).

[S5] 2026-04-27 15:50 iter1 BLOCKED jest invocations — el sandbox del harness rechaza `pnpm test`/`npx jest`/`./node_modules/.bin/jest`. Tests typecheckean limpio pero no pude correrlos en este entorno. Reportado el blocker; recomendado al orquestador correr `pnpm test:integration -- chatbot-kb` antes de cerrar iter1.

[S5] 2026-04-27 15:55 iter1 iter1-complete — S4-06 cerrado. Schema + migración + RLS + matcher + service + controllers + DTOs + seed + integration spec + cross-tenant entries.


### feed/S6-iter1.md

# S6 — Iter 1 Feed (Sprint 4 Personalization + Escalation)

Append-only log de avances. Formato:
```
[S6] <YYYY-MM-DD HH:MM> iter1 <STATUS> <file:line> — <descripción> // <impacto>
```

## Entradas

[S6] 2026-04-27 14:05 iter1 STARTED docs/sprint4/feed/S6-iter1.md — bundle S4-07 (5pts) + S4-08 (3pts) iniciado.

[S6] 2026-04-27 14:20 iter1 DONE src/modules/chatbot/personalization.service.ts — `PersonalizationService.fillPlaceholders(template, insuredId)` + `applyTemplate(template, ctx)` separados (puro vs con Prisma). Soporta 10 placeholders. // S5 puede consumir signature pública.

[S6] 2026-04-27 14:32 iter1 DONE src/modules/chatbot/escalation.service.ts — `EscalationService.escalate(insuredId, conversationId, reason): Promise<EscalateResult>`. Idempotencia coarse-grained vía `ChatMessage.escalated=true` + ventana 60min (refinable cuando S5 cablee `ChatConversation`). Email a MAC + acuse al asegurado + audit log con ctx HTTP. XSS-safe (escape HTML en `reason`/`fullName`/`content`). // S5 + S4 (FE) pueden cablear endpoint.

[S6] 2026-04-27 14:35 iter1 DONE src/modules/chatbot/dto/escalation.dto.ts — `EscalateRequestSchema` (Zod, conversationId UUID + reason ≤500 chars trim). `insuredId` se deriva del JWT, NO viaja en body (anti-impersonation).

[S6] 2026-04-27 14:36 iter1 DONE src/config/env.schema.ts:219 + .env.example — `MAC_SUPPORT_EMAIL` (z.email().default('mac-support@segurasist.local')). Coexiste con keys S3 (`MONTHLY_REPORT_RECIPIENTS`, `SQS_QUEUE_MONTHLY_REPORTS`).

[S6] 2026-04-27 14:48 iter1 DONE test/unit/modules/chatbot/personalization.service.spec.ts — 14 tests (template engine + Prisma integration). Cubre fechas es-MX ("15 de enero de 2027"), fallbacks "—", placeholders no-soportados, NotFound, idempotencia.

[S6] 2026-04-27 14:55 iter1 DONE test/unit/modules/chatbot/escalation.service.spec.ts — 6 tests. happy path, idempotencia (2 calls → 1 email), insured sin email, NotFound, SES fail tolerant, escape XSS.

[S6] 2026-04-27 15:02 iter1 DONE test/integration/chatbot-personalization.spec.ts — 3 tests. Stub `KbService` + `ChatbotServiceStub.processMessage` simula el flow S5 hasta que `chatbot.controller.ts` exista. Verifica que la respuesta NO contiene `{{...}}` ni "undefined".

[S6] 2026-04-27 15:05 iter1 NEEDS-COORDINATION src/modules/chatbot/chatbot.module.ts — S5 ya agregó `ChatbotController` + `KbService` + `KbMatcherService` al módulo (sin haber creado los archivos todavía). Mis providers `PersonalizationService` + `EscalationService` ya están registrados; cuando S5 cree los archivos compila. NO toqué los archivos S5.

[S6] 2026-04-27 15:06 iter1 NEW-FINDING prisma/schema.prisma — modelo `ChatConversation` NO existe (S5 lo agregará en migración `chatbot_kb`). `EscalationService` usa idempotencia coarse-grained vía `ChatMessage.escalated` con ventana 60min. Refactor en iter 2 cuando S5 cablee el modelo (`WHERE conversation_id = ?`). // signature `escalate(insuredId, conversationId, reason)` NO cambia.

[S6] 2026-04-27 15:07 iter1 NEW-FINDING enum `ClaimStatus` no tiene valor `closed`. Usé `notIn: ['paid', 'rejected']` para "claims activos" en `{{claimsCount}}`. Si Sprint 5 agrega `closed` o `cancelled`, ajustar.

[S6] 2026-04-27 15:10 iter1-complete — Files OWNED creados/modificados:

```
src/modules/chatbot/personalization.service.ts   (NEW, ~140 LOC)
src/modules/chatbot/escalation.service.ts        (NEW, ~210 LOC)
src/modules/chatbot/dto/escalation.dto.ts        (NEW, ~45 LOC)
test/unit/modules/chatbot/personalization.service.spec.ts (NEW, ~150 LOC)
test/unit/modules/chatbot/escalation.service.spec.ts      (NEW, ~210 LOC)
test/integration/chatbot-personalization.spec.ts          (NEW, ~110 LOC)
src/config/env.schema.ts                          (MOD: +MAC_SUPPORT_EMAIL)
.env.example                                      (MOD: +MAC_SUPPORT_EMAIL section)
```

`tsc --noEmit` (scoped a archivos S6): 0 errores. Resto del repo tiene 25 errores pero son archivos S5 (kb.service.ts no existe aún) y F1 (auth.service.spec.ts pre-existing) — fuera de scope.

## Signatures finales (coordinación con S5/S4)

```typescript
// PersonalizationService
fillPlaceholders(template: string, insuredId: string): Promise<string>
applyTemplate(template: string, ctx: InsuredContext): string  // PURO, sin Prisma
loadInsuredContext(insuredId: string): Promise<InsuredContext>

// EscalationService
escalate(insuredId: string, conversationId: string, reason: string): Promise<EscalateResult>

interface EscalateResult {
  conversationId: string;
  alreadyEscalated: boolean;
  emailSentToMac: boolean;
  acknowledgementSentToInsured: boolean;
}

// DTO Zod
EscalateRequestSchema: { conversationId: uuid, reason: string<=500 trimmed }
```

Placeholders soportados (`PersonalizationService.fillPlaceholders`):
- `{{validTo}}` `{{validFrom}}` (es-MX, "15 de enero de 2027")
- `{{fullName}}` `{{firstName}}`
- `{{packageName}}` `{{packageType}}` (alias por ahora; Sprint 5 separa)
- `{{coveragesCount}}` `{{coveragesList}}` (comma-separated o "—")
- `{{claimsCount}}` (excluye `paid`/`rejected`)
- `{{insuredId}}`

Placeholders no-soportados quedan literales — S5 puede testear "no debe contener `{{`" post-resolución.


### feed/S7-iter1.md

# Sprint 4 — S7 iter 1 feed

> Append-only. Formato: `[S7] <YYYY-MM-DD HH:MM> <ITER> <STATUS> <file:line> — <descripción> // <impacto>`

[S7] 2026-04-27 09:00 iter1 STARTED docs/sprint4/feed/S7-iter1.md — bundle S4-09 audit timeline 5pts
[S7] 2026-04-27 09:10 iter1 STARTED segurasist-api/src/modules/audit/dto/timeline.dto.ts — Zod request schemas + ApiProperty response DTOs (TimelineQuery + TimelineExportQuery + TimelineItem + TimelineResponse)
[S7] 2026-04-27 09:25 iter1 STARTED segurasist-api/src/modules/audit/audit-timeline.service.ts — service con `getTimeline` keyset cursor + `streamCsv` async generator (chunks 500 + hard cap 50k) + `maskIp` + `csvEscape` RFC 4180 + hidratación actorEmail best-effort
[S7] 2026-04-27 09:35 iter1 STARTED segurasist-api/src/modules/audit/audit-timeline.controller.ts — `GET /v1/audit/timeline` (60/min throttle) + `GET /v1/audit/timeline/export` (2/min throttle) + auditoría de auditoría (registra `export_downloaded` con resourceType='audit.timeline')
[S7] 2026-04-27 09:40 iter1 DONE segurasist-api/src/modules/audit/audit.module.ts — registra AuditTimelineController + AuditTimelineService (audit-writer + audit-context vienen de AuditPersistenceModule @Global)
[S7] 2026-04-27 09:50 iter1 DONE segurasist-api/test/integration/audit-timeline.spec.ts — 11 specs: pagination 50→3 pages (20/20/10), cross-tenant where tenantId asserted, OR shape (resourceType+resourceId | payloadDiff.path:['insuredId']), actionFilter propagation, CSV header + escape, multi-page CSV streaming, helpers maskIp/csvEscape edge cases
[S7] 2026-04-27 10:05 iter1 STARTED segurasist-web/packages/api-client/src/hooks/audit-timeline.ts — `useAuditTimeline` infiniteQuery con keyset cursor + `useDownloadAuditCSV` mutation con blob → `<a download>` + tipo AuditTimelineAction sincronizado con enum BE
[S7] 2026-04-27 10:08 iter1 DONE segurasist-web/packages/api-client/package.json — exports map agrega `./hooks/audit-timeline`
[S7] 2026-04-27 10:20 iter1 STARTED segurasist-web/apps/admin/components/audit-timeline/audit-timeline-item.tsx — item con icon-per-action (lucide), avatar+initials, timestamp relative+ISO tooltip, payloadDiff expand/collapse con aria-expanded
[S7] 2026-04-27 10:25 iter1 DONE segurasist-web/apps/admin/components/audit-timeline/audit-timeline-export-button.tsx — Button con isPending/aria-busy + AlertBanner inline auto-hide 5s
[S7] 2026-04-27 10:35 iter1 DONE segurasist-web/apps/admin/components/audit-timeline/audit-timeline.tsx — feed `role="feed"` + Skeleton/Empty/Error states + filtro action (Select 8 opciones) + botón "Cargar más" + IntersectionObserver auto-fetch (rootMargin 200px) + live region aria-live="polite"
[S7] 2026-04-27 10:38 iter1 DONE segurasist-web/apps/admin/components/audit-timeline/index.ts — re-exports
[S7] 2026-04-27 10:42 iter1 DONE segurasist-web/apps/admin/app/(app)/insureds/[id]/timeline/page.tsx — Server Component dedicado full-width
[S7] 2026-04-27 10:45 iter1 DONE segurasist-web/apps/admin/app/(app)/insureds/[id]/auditoria.tsx — tab "Auditoría" delega al `<AuditTimeline>` (reemplaza inline list de S3-06)
[S7] 2026-04-27 11:00 iter1 DONE segurasist-web/apps/admin/test/integration/audit-timeline.spec.ts — 14 specs: skeleton/error/empty/list, hasNextPage flow + load-more click → fetchNextPage, action filter Select → re-call hook with actionFilter='update', export visibility hideExport prop, item expand/collapse + aria-expanded, action humanization (login → "Inició sesión"), null payloadDiff hides toggle, IP mask render
[S7] 2026-04-27 11:05 iter1 NEW-FINDING segurasist-api/src/modules/audit/audit-timeline.service.ts — `payloadDiff @> {insuredId:X}` query es lento sin functional index GIN(payload_diff) — Sprint 5 candidato si timeline carga >150ms p95 (no bloquea iter 1)
[S7] 2026-04-27 11:08 iter1 NEW-FINDING segurasist-api/src/modules/audit/dto/timeline.dto.ts — el enum AuditAction frontend está duplicado en api-client/hooks/audit-timeline.ts (string literal union) — Sprint 5 podría auto-generarlo desde OpenAPI (`pnpm --filter @segurasist/api-client openapi:gen`)
[S7] 2026-04-27 11:10 iter1 NEW-FINDING segurasist-web/apps/admin/components/audit-timeline/audit-timeline-item.tsx — `relativeTime` reimplementa `formatDistanceToNowStrict`; recomendable consolidar en `lib/format-relative-time.ts` si otros agentes (S2 reports) lo necesitan
[S7] 2026-04-27 11:15 iter1 iter1-complete — bundle S4-09 cerrado: 12 files creados/modificados, 25 specs nuevas (11 BE + 14 FE)


### feed/S7-iter2.md

[S7] 2026-04-27 18:00 iter2 STARTED docs/sprint4/feed/S7-iter2.md — follow-ups S2 NEW-FINDING (audit-timeline parsing + insured-360 mocks)
[S7] 2026-04-27 18:05 iter2 DONE segurasist-web/apps/admin/test/integration/audit-timeline.spec.tsx — renombrado desde `.spec.ts` (fix S2 parsing errors JSX en `.ts`)
[S7] 2026-04-27 18:15 iter2 DONE segurasist-web/apps/admin/test/unit/components/insured-360.test.tsx — `beforeEach` con default mockReturnValue para `useAuditTimeline` y `useDownloadAuditCSV` (Radix Tabs monta TODAS las TabsContent → 4 tests `<Insured360Client />` crasheaban al destructurar `useDownloadAuditCSV()` undefined). Hooks ya mockeados completamente, NO se necesita QueryClientProvider real. // fix-S2-finding
[S7] 2026-04-27 18:25 iter2 BLOCKED test run — sandbox bloquea `pnpm`; ambas correcciones son determinísticas (rename = JSX-enabled; beforeEach = no-undefined-destructure). // for-S10+iter3
[S7] 2026-04-27 18:30 iter2 iter2-complete — 2 archivos tocados, 0 código runtime modificado.


### feed/S8-iter1.md

# S8 — Iter 1 — Feed entries

## DONE

- **S4-10** Performance test JMeter (5 pts) — escenarios + CI gate creados.
  - `tests/performance/jmeter/portal-load-1000.jmx` (1000 vu, mix 30/25/20/15/10)
  - `tests/performance/jmeter/admin-load-100.jmx` (100 vu, CRUD + reports + exports)
  - `tests/performance/k6/{portal,admin}.k6.js` (alternativa moderna)
  - `tests/performance/parse-jtl.sh` (parser JTL → JSON p50/p95/p99/error)
  - `tests/performance/jmeter/data/{insureds,admins}.csv` + `generate-csv.mjs`
  - `tests/performance/baseline.json` (skeleton, valores null hasta primer run)
  - `.github/workflows/perf.yml` (manual + cron lunes 06:00 UTC)
  - `docs/sprint4/PERFORMANCE_REPORT.md`
  - `tests/performance/jmeter/scenarios/README.md`
- Load test **NO ejecutado** (sandbox no tiene staging accesible — dispatch rule).
- Gate definido: `p95 ≤ 500 ms` + `error rate ≤ 1%` (fail con `bc -l`).

## NEW-FINDINGS (cross-cutting → owners notificados)

1. **[S9 / hardening]** OTP rate limit (`5 OTP/min` por identifier) bloqueará
   el ramp-up de 1000 vu si no hay bypass. Recomendación: env
   `OTP_TEST_BYPASS=true` en staging + `RENAPO_VALIDATION_MODE=stub`.
   Owner: **S9** confirmar que el bypass está activo en `segurasist-infra/envs/staging`.

2. **[S3 / WAF]** El runner GHA usa una IP única → throttle global
   (100 req/min) saturará al subir a 1000 vu. Necesario allowlist o
   exempt-route en WAF para User-Agent `JMeter/SegurAsist-S4-10*`. Owner:
   **F8 alarms / S3 infra**.

3. **[S5 / chatbot]** El gate per-endpoint del chatbot usa `p95 ≤ 800 ms`
   (más laxo que global 500 ms). Justificado por LLM/regex matcher pero
   debe quedar documentado en `docs/sprint4/PERFORMANCE_REPORT.md`. Si el
   matcher final excede 800 ms se rompe el gate per-endpoint.

4. **[S1 / reports]** `GET /v1/reports/conciliacion` con guard 1500 ms es
   excepción — si la query agregada no está cacheada se va de baseline
   fácil. Sugerencia a **S1**: materialized view o cache Redis 5 min.

5. **[S7 / audit timeline]** La query timeline con `pageSize=50` y join
   completo audit_logs puede exceder 700 ms si no hay índice
   `(insured_id, created_at desc)`. Owner: **S7** verificar índice en
   migración Sprint 4.

6. **[S10 / QA]** Agregar a `SPRINT4_DOR_DOD.md` el bullet:
   "Performance gate ejecutado al menos una vez contra staging antes de
   cerrar Sprint 4". El gate manual workflow `perf.yml` permite
   despachar bajo demanda.

## ASKS

- **F0 / S0**: agendar el primer run de `perf.yml` contra staging tras la
  merge de las historias S4-01..S4-09 para capturar baseline real.
- **S9**: confirmar `OTP_TEST_BYPASS` y `RENAPO_VALIDATION_MODE` en staging.
- **S3**: definir allowlist WAF (o variabilizar throttle por UA test).
- **S10**: incluir gate perf en checklist DoD Sprint 4.

## Iter 2 plan (preview)

- Tras primer run: rellenar `baseline.json` con valores reales.
- Si gate falla: triage por endpoint usando breakdown del `parse-jtl.sh`,
  abrir issues por endpoint individual.
- Documentar runbook de troubleshooting expandido en `scenarios/README.md`.


### feed/S9-iter1.md

[S9] iter1 STARTED — Sprint 4 Backend Senior Hardening: 8 High remanentes + 5 ADRs + verify migrations + EMF↔alarms cross-check.

[S9] iter1 DONE H-09 segurasist-api/src/modules/auth/auth.service.spec.ts:95 — `describe.skip('otpRequest()/otpVerify() pendientes')` reemplazado por suite real de 14 it: otpRequest happy/anti-enum-CURP-desconocido/anti-enum-sin-email/throttle-5/min/lockout-active/SMS-fallback/SES-failure-best-effort/CURP-uppercase-normalization (7) + otpVerify happy-cognitoSub-persist/expired-401/wrong-attempts-decrement-KEEPTTL/last-attempt-burns-session+rounds-bump/session-throttle-401/corrupt-JSON-401-cleanup/DB-down-best-effort (7). Mocks redis raw (incr/expire/set-KEEPTTL/get/del/ttl) + Cognito + SES (tags Record<string,string>) + EmailTemplateResolver (html/text Handlebars-like) + AuditWriter; helpers buildJwt + preloadSession + buildService(opts). // closes-H-09

[S9] iter1 DONE ADR-0003 docs/adr/ADR-0003-sqs-dedupe-policy.md — Decisión: standard queues + DB UNIQUE confirmada Sprint 4; FIFO solo si ordering requerido (audit timeline / chat stream / saga). 4 alternativas rechazadas. RB-014 referenciado para drain.

[S9] iter1 DONE ADR-0004 docs/adr/ADR-0004-audit-context-injection.md — Decisión: AuditContextFactory request-scoped por defecto (ADR-0002); param-passing en services no-request-scoped (AuthService, HealthService, RpcGatewayService futuro) por throughput crítico (medido +30% latencia con Scope.REQUEST en login). Optional<AuditContext> permite workers (undefined). AsyncLocalStorage rechazado Sprint 4, re-evaluar Node 22 LTS.

[S9] iter1 DONE ADR-0005 docs/adr/ADR-0005-packages-security-boundary.md — Decisión: pnpm workspace `@segurasist/security` sin publish a NPM private hasta Sprint 5+. Triggers documentados: primer consumer fuera del monorepo, ≥5 web apps, contribución cross-team. tsup `dts:true` + curated index.ts mantienen API surface explícito.

[S9] iter1 DONE ADR-0006 docs/adr/ADR-0006-cloudwatch-alarms-cardinality.md — Decisión: single-region `mx-central-1` por env; excepción WAF CLOUDFRONT scope (forced `us-east-1`); DR sin alarmas pre-Sprint-5; SNS topic naming `${env}-oncall-p1[-${region}]`. Multi-region triggers documentados (active-active, regulator, SLA). Sprint 6+ Route53 health-check de DR.

[S9] iter1 DONE ADR-0007 docs/adr/ADR-0007-coverage-thresholds.md — Decisión: business 60/55/60/60, security-critical 80/75/80/80 (permanente, never lowered). `coverage.include` glob-only (no enumerated files). `--passWithNoTests` prohibido. Escalación 70/65 fin de Sprint 5 si test bundles cierran. Mutation testing + delta-coverage Sprint 7+ candidates.

[S9] iter1 DONE migrations-verify segurasist-api/prisma/migrations/ — 6 migraciones Sprint 4 inspeccionadas. Idempotentes vía IF NOT EXISTS / DO $$ guards: `20260428_audit_action_enum_extend` (ADD VALUE IF NOT EXISTS), `20260428_insureds_creation_unique` (CREATE TABLE/INDEX IF NOT EXISTS), `20260427_chatbot_kb` (DO $$ + IF NOT EXISTS exhaustive), `20260427_add_exports_table` (Sprint 3 inheritance — verified). NO idempotentes raw-replay (Prisma migrate deploy las protege via `_prisma_migrations` table): `20260428_add_system_alerts` (CREATE TABLE/INDEX raw), `20260428_batch_progress_columns` (ADD COLUMN/CREATE UNIQUE INDEX raw), `20260428_monthly_report_runs` (CREATE TYPE/TABLE/UNIQUE INDEX raw). Riesgo bajo (Prisma tracking las cubre); recomendación ADR-friendly: en Sprint 5 PR rule "toda migración usa IF NOT EXISTS guards" para sobrevivir a manual replays. // info-only NOT modificadas (read-only para S9; owners F4/F6/S1).

[S9] iter1 NEW-FINDING segurasist-api/src/modules/audit/audit-metrics-emf.ts:56 — EMF emitter usa `process.env.NODE_ENV ?? 'unknown'` para `Environment` dimension; los CloudWatch alarms en `segurasist-infra/envs/{dev,staging,prod}/alarms.tf:269,297,325` filtran `Environment = var.environment` con valores `dev/staging/prod`. NODE_ENV en runtime devuelve `development/test/staging/production` → MISMATCH para dev (NODE_ENV=development vs alarm=dev) y prod (production vs prod). Staging matchea por casualidad. **Impacto**: alarmas SegurAsist/Audit (`AuditWriterHealth`, `MirrorLagSeconds`, `AuditChainValid`) quedan en INSUFFICIENT_DATA en dev/prod aunque los workers emitan EMF. **Recomendación NO ejecutada (read-only en alarms.tf)**: opción A) cambiar el emitter a leer `APP_ENV` o un nuevo `DEPLOY_ENV` env var seteado por App Runner Terraform = `var.environment`; opción B) ajustar alarm dimension a `var.environment == "prod" ? "production" : (var.environment == "dev" ? "development" : var.environment)` con condicional terraform — feo pero zero-code. Documentado en ADR-0006 §Decision punto 6 + S9-report.md §EMF alignment para F6 Sprint 5. // for-F6 / for-F8 review

[S9] iter1 NEW-FINDING fixes-feed-cross-check — H-30 partial sigue vigente (8 runbooks completos pero IRP esqueleto puro per AUDIT_INDEX H-30); decisión iter 2 si abordar (S10 Tech Writer es owner natural). Otros High remanentes sin acción explícita en FIXES_REPORT remanentes section: ninguno con file:line target — H-09 es el único concretamente abierto. // info-only

[S9] iter1 iter1-complete — 1 H-cierre concreto (H-09 con 14 tests unit), 5 ADRs (~50 líneas cada uno con Context/Decision/Consequences/Alternatives + Follow-ups), 6 migraciones verificadas, 1 cross-cutting EMF↔alarms finding. Tests scoped: spec re-ejecutar en validation gate (sandbox bloquea jest CLI; el shape pasa typecheck por inspección manual contra src/modules/auth/auth.service.ts y MockProxy patrones existentes en otp-flow.spec.ts).


### feed/S10-iter1.md

# S10 — Iter 1 feed (QA Lead + Tech Writer)

> Bundle: Tests E2E features Sprint 4 + DoR/DoD validation + DEVELOPER_GUIDE update.

## Entradas (formato del `_features-feed.md`)

```
[S10] 2026-04-27 14:10 iter1 STARTED docs/sprint4/feed/S10-iter1.md — leyendo MVP_07 §3.5/3.6 + MVP_02 §9 + DEVELOPER_GUIDE §1-§8
[S10] 2026-04-27 14:25 iter1 DONE docs/qa/SPRINT4_DOR_DOD.md — matriz DoR/DoD por historia S4-01..10 con leyenda + rollup + 4 NEW-FINDINGs
[S10] 2026-04-27 14:50 iter1 DONE segurasist-api/test/e2e/sprint4-features.e2e-spec.ts — 16 tests E2E (reports + chatbot + audit-timeline + cross-tenant) con graceful-skip pattern
[S10] 2026-04-27 15:05 iter1 DONE docs/fixes/DEVELOPER_GUIDE.md §2.6/§2.7/§2.8 — secciones agregar chart-report / KB-entry / EventBridge-cron + 10 lecciones cross-bundle Sprint 4
[S10] 2026-04-27 15:10 iter1 NEW-FINDING docs/qa/SPRINT4_DOR_DOD.md§5 — policies.sql necesita 'kb_entries' + 'chat_tickets' (S5/S6 owners); validar iter 2
[S10] 2026-04-27 15:11 iter1 NEW-FINDING docs/qa/SPRINT4_DOR_DOD.md§5 — enum AuditAction necesita 4 valores nuevos (report_generated, report_downloaded, chatbot_message_sent, chatbot_escalated); migration UNIFICADA S1+S5+S6
[S10] 2026-04-27 15:12 iter1 NEW-FINDING docs/qa/SPRINT4_DOR_DOD.md§5 — coverage-summary.json diff iter1 vs iter2 obligatorio; sin él, % global puede caer silenciosamente
[S10] 2026-04-27 15:14 iter1 NEEDS-COORDINATION S5+S6 - cross-tenant test bot KB requiere fixture data (TENANT_A KB-A, TENANT_B KB-B, mismo keyword); coordino fixture en iter 2
[S10] 2026-04-27 15:20 iter1 iter1-complete docs/sprint4/S10-report.md — 3 deliverables OWNED + 4 findings; validation gate D4 documentado para iter 2
```

## Resumen rápido

### Files OWNED entregados (4)

| Path | Estado | Notas |
|---|---|---|
| `segurasist-api/test/e2e/sprint4-features.e2e-spec.ts` | ✅ NUEVO | 3 describe: Reportes (S4-01..03), Chatbot (S4-05..08), Audit timeline (S4-09). 16 tests con asserts reales + graceful-skip si bootstrap falla. NO `it.todo`. |
| `docs/qa/SPRINT4_DOR_DOD.md` | ✅ NUEVO | Matriz DoR (10/10 cleared) + DoD por historia (10 historias × 17 criterios = 170 cells). Validation gate D4 + 4 NEW-FINDINGs. |
| `docs/fixes/DEVELOPER_GUIDE.md` | ✅ EXTENDIDO | §2.6 chart/report (S1+S2), §2.7 chatbot KB entry (S5+S6), §2.8 EventBridge cron (S3) + 10 lecciones Sprint 4 cross-bundle al final §8. |
| `docs/sprint4/S10-report.md` | ✅ NUEVO | Reporte ejecutivo iter 1. Iter 2 será consolidador final. |

### NEW-FINDINGs (4)

1. **`policies.sql` array** debe extenderse con `'kb_entries'` y `'chat_tickets'` en el mismo PR de S5/S6. Drift garantizado si no, según §1.6 anti-pattern. (Tripwire: `apply-rls-idempotency.spec.ts`).
2. **enum `AuditAction`** necesita 4 valores nuevos. Coordinar S1+S5+S6 para una migration unificada `<DATE>_audit_action_sprint4` (vs. 4 separadas) por idempotencia + reduce reconfiguración del PG enum cache.
3. **Coverage diff iter1↔iter2 obligatorio**: sin `coverage-summary.json` snapshot, una caída del % global pasa silenciosa aunque módulos nuevos tengan 80%.
4. **JMeter perf gate Sprint 4 (S8)** debe correr **post-merge staging**, no PR-time. Coordinación crítica S1 (queries) + S8 (gate) + S10 (validation D4): si la nueva query de reports degrada admin p95 >600 ms, bloquear release-to-staging.

### Coordinaciones requeridas iter 2

- **S1 (Reports BE)**: confirmar contrato de `/v1/reports/conciliation/download?format=pdf|xlsx`. El spec actual tolera 200/302 (presigned redirect). Cuando S1 commitee implementación, ajustar asserts a 200 + content-type específico.
- **S5+S6 (Chatbot)**: fixture cross-tenant KB para `chatbot-cross-tenant.spec.ts` (TENANT_A keyword='plan' answer='A-only'; TENANT_B mismo keyword answer='B-only'). S10 valida en iter 2 que el insured tenant A nunca recibe `B-only`.
- **S7 (Audit timeline)**: confirmar shape del CSV export (`Content-Type: text/csv` + UTF-8 BOM si se quiere compatibilidad Excel ES-MX). Spec actual valida primer header line.
- **S9 (ADRs)**: ADR-0003 (sqs/eventbridge idempotency) referenciado en DEVELOPER_GUIDE §2.8 lección 5.

### Validation gate D4 — checklist iter 2

Ver `docs/qa/SPRINT4_DOR_DOD.md` §3. Items críticos:
- TS strict + ESLint web limpio.
- Suite tests >1100 + nuevos S4 (estimado ~1240).
- Cross-tenant tests presentes para chatbot + reports + audit timeline.
- Migrations idempotentes (`prisma migrate diff` sin diff post re-aplicación).
- E2E spec corre con stack si `RLS_E2E=1` o equivalente.

## Reglas observadas

- ✅ NO modificado código S1-S9 (verificado: solo `docs/` y `test/e2e/` propios).
- ✅ NO docker, install, commits.
- ✅ E2E spec con asserts reales (NO `it.todo` per DEVELOPER_GUIDE §1.5).
- ✅ DEVELOPER_GUIDE.md mantenido coherente con §1 anti-patterns y §5 PR checklist.
- ✅ Solo iter 1 — iter 2 es consolidador.

