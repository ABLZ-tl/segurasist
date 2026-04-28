# Sprint 4 — Dispatch Plan (10 agentes × 2 iter)

**Goal**: 59 pts (10 historias S4-01..S4-10) + 8 High remanentes Sprint 3 hardening.

**Periodo**: Sprint 4 week 1-2 (días 16-25 según MVP_02).

**Calidad obligatoria** (ver `docs/fixes/DEVELOPER_GUIDE.md` 638 líneas — lectura obligatoria pre-PR):
- TDD: tests primero, suite scoped pasa antes de marcar DONE.
- Coverage thresholds 60/55/60/60 (security-critical 80/75).
- AuditContextFactory.fromRequest(req) en todo audit log.
- @Throttle en endpoints públicos.
- DTOs Zod + @ApiProperty Swagger.
- RLS en cada tabla nueva (migración + policies.sql array + cross-tenant test).
- Cookie/CSRF: importar desde `@segurasist/security`.
- Idempotencia DB-side con UNIQUE constraints (SQS standard NO acepta dedupeId).
- Audit timeline events con ctx HTTP (ip, ua, traceId).

## Asignación de bundles (10 agentes paralelos)

| Agent | Rol | Bundle / Historias | Pts |
|---|---|---|---|
| **S1** | Backend Senior Reports BE | S4-01/02/03 backend (queries + workers + DTOs) | 23 |
| **S2** | Frontend Senior Reports FE | S4-01/02/03 frontend (charts + descarga + admin pages) | — (compartido S4-01) |
| **S3** | DevOps + Backend Cron | S4-04 EventBridge cron + Lambda scheduled + email mensual | 5 |
| **S4** | Frontend Senior Chatbot | S4-05 widget UI portal + S4-08 escalamiento UI | 8 |
| **S5** | Backend Senior NLP/KB | S4-06 KB structure + matching engine + admin CRUD | 8 |
| **S6** | Backend Senior Personalization | S4-07 chatbot personalización con context asegurado | 5 |
| **S7** | Full-stack Audit Timeline | S4-09 audit timeline vista 360 (BE pagination + FE timeline + CSV export) | 5 |
| **S8** | DevOps Performance | S4-10 JMeter scenarios + CI gate + baseline | 5 |
| **S9** | Backend Senior Hardening | 8 High remanentes + ADRs + apply migrations + emisión EMF queries | — |
| **S10** | QA Lead + Tech Writer | Tests E2E features + DEVELOPER_GUIDE.md update + Sprint 4 DoR/DoD validation | — |

## File Ownership Map (estricto)

### Backend API

| Path | Owner |
|---|---|
| `src/modules/reports/**` (NUEVO) | **S1** (incluye DTOs, service, controller, queries) |
| `src/workers/reports-worker.service.ts` | **S1** (extender para agendar mensual) |
| `src/modules/reports/dto/**` | **S1** |
| `prisma/schema.prisma` (modelo `Report` si nuevo + `ChatMessage` + `KnowledgeBase`) | sección por owner: Report→S1, Chat→S5, AuditTimeline reuse existente |
| `prisma/migrations/<DATE>_reports_table/` | **S1** |
| `prisma/migrations/<DATE>_chatbot_kb/` | **S5** |
| `src/modules/chatbot/**` (NUEVO) | **S5** + **S6** |
| `src/modules/chatbot/kb.service.ts` | **S5** |
| `src/modules/chatbot/personalization.service.ts` | **S6** |
| `src/modules/chatbot/escalation.service.ts` | **S6** o **S5** (decidir) |
| `src/modules/chatbot/dto/**` | **S5** |
| `src/modules/audit/audit-timeline.service.ts` (NUEVO) | **S7** |
| `src/modules/audit/audit-timeline.controller.ts` | **S7** |
| `src/modules/audit/dto/timeline.dto.ts` | **S7** |
| `src/infra/aws/eventbridge.service.ts` (NUEVO) | **S3** |
| `src/lambdas/monthly-reports/**` (NUEVO si se decide Lambda) | **S3** |
| `src/common/guards/<existing>` | READ-ONLY (no modificar) |

### Frontend

| Path | Owner |
|---|---|
| `apps/admin/app/(app)/reports/**` (NUEVO) | **S2** |
| `apps/admin/components/reports/**` | **S2** |
| `apps/admin/components/charts/**` (NUEVO si shadcn-charts/recharts) | **S2** |
| `apps/portal/components/chatbot/**` (NUEVO widget) | **S4** |
| `apps/portal/app/api/chatbot/**` (NUEVO proxy) | **S4** (consume @segurasist/security/proxy) |
| `apps/admin/app/(app)/insureds/[id]/timeline/**` (NUEVO) | **S7** |
| `apps/admin/components/audit-timeline/**` | **S7** |
| `packages/ui/src/components/charts/**` | **S2** |
| `packages/api-client/src/hooks/reports.ts` | **S2** (con tests) |
| `packages/api-client/src/hooks/chatbot.ts` | **S4** + **S5** |
| `packages/api-client/src/hooks/audit-timeline.ts` | **S7** |

### Infra

| Path | Owner |
|---|---|
| `segurasist-infra/modules/eventbridge-rule/**` (NUEVO) | **S3** |
| `segurasist-infra/envs/{env}/main.tf` (cron resource) | **S3** |
| `segurasist-infra/envs/{env}/alarms.tf` (alarm cron failure) | **S3** (extender módulo F8) |
| Performance test artifacts | **S8** (`tests/performance/jmeter/`) |
| `.github/workflows/perf.yml` (NUEVO) | **S8** |

### Tests

| Path | Owner |
|---|---|
| `test/integration/reports-flow.spec.ts` | **S1** |
| `test/integration/chatbot-kb.spec.ts` | **S5** |
| `test/integration/chatbot-personalization.spec.ts` | **S6** |
| `test/integration/audit-timeline.spec.ts` | **S7** |
| `test/integration/eventbridge-cron.spec.ts` | **S3** |
| `apps/admin/test/integration/reports-page.spec.ts` | **S2** |
| `apps/portal/test/integration/chatbot-widget.spec.ts` | **S4** |
| `apps/admin/test/integration/audit-timeline.spec.ts` | **S7** |
| `tests/performance/**` | **S8** |
| `tests/e2e/sprint4-features.e2e-spec.ts` | **S10** |

### Docs

| Path | Owner |
|---|---|
| `docs/sprint4/_features-feed.md` | TODOS append |
| `docs/sprint4/feed/S<N>-iter<X>.md` | cada agente |
| `docs/sprint4/S<N>-report.md` | cada agente |
| `docs/sprint4/SPRINT4_REPORT.md` | S0 (orquestador post-iter2) |
| `docs/fixes/DEVELOPER_GUIDE.md` | **S10** (extender con patterns Sprint 4) |
| `docs/adr/ADR-0003*..0007*.md` | **S9** (5 ADRs) |
| `docs/qa/SPRINT4_DOR_DOD.md` | **S10** |

## Reglas absolutas

1. **READ-ONLY**: `docs/audit/`, `docs/fixes/`, código que NO esté en tu OWNED list.
2. **NO** docker, deploys, push, commits.
3. **SI** `pnpm test`, typecheck, lint scoped al módulo.
4. **Tests primero (TDD)**: spec con assertions reales, NO `it.todo`.
5. **Coverage**: archivos nuevos contribuyen al threshold automáticamente.
6. **AuditContextFactory.fromRequest(req)** en todo audit log nuevo.
7. **DTOs Zod** + `@ApiProperty` Swagger en endpoints públicos.
8. **RLS**: cada tabla nueva con `tenant_id` → migración + `policies.sql` array + cross-tenant test.
9. **Cookie/CSRF**: importar SIEMPRE desde `@segurasist/security`.
10. **Throttle**: `@Throttle` en endpoints públicos (chatbot público no, autenticado sí).
11. **Idempotencia DB-side**, NO `MessageDeduplicationId` en SQS standard.
12. **Cross-cutting findings** → NEW-FINDING en feed, NO arreglar fuera de scope.

## Output esperado por agente

`docs/sprint4/S<N>-report.md`:
```markdown
# Sprint 4 Report — S<N> <bundle>

## Iter 1
- Historias cerradas: S4-XX
- Files creados / modificados (count + paths)
- Tests añadidos: N (paths)
- Tests existentes: ✅ N pass / ❌ M fail
- Cross-cutting findings (referencias al feed)

## Iter 2
- Follow-ups del feed integrados
- Coordinaciones con otros agentes
- Tests post-iter2

## Compliance impact
- DoR/DoD checklist por historia

## Lecciones para DEVELOPER_GUIDE.md
- (3-5 bullets)
```
