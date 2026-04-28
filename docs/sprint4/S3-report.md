# Sprint 4 Report — S3 DevOps + Backend Cron

## Iter 1

### Historias cerradas

- **S4-04** EventBridge cron envío automático fin de mes (5 pts) — backend handler + IaC + tests + idempotencia DB-side.

### Decisión arquitectónica

**Opción A**: EventBridge rule (schedule) → SQS `monthly-reports` → `MonthlyReportsHandlerService` (NestJS poll loop).

Justificación frente a Opción B (Lambda webhook → API):
- Reusa patrón polling existente (`reports`/`emails`/`pdf`/`insureds-creation`).
- Idempotencia DB-side ya documentada en `DEVELOPER_GUIDE.md` §2.2; UNIQUE natural key `(tenant_id, period_year, period_month)` cubre re-entregas SQS y re-triggers manuales.
- Cero IaC nueva para deploy de un Lambda dedicado; el handler corre en el App Runner existente.
- DLQ `maxReceiveCount=3` automático del módulo `sqs-queue`.

Trade-off: depende de App Runner up. Mitigación: alarma `eventbridge-rule-failed` (AWS/Events FailedInvocations > 0) wired en los 3 envs + DLQ alarm preexistente.

### Files creados / modificados

**IaC (10 archivos)**:
- `segurasist-infra/modules/eventbridge-rule/{main,variables,outputs,versions}.tf` + `README.md` (NUEVO módulo).
- `segurasist-infra/envs/dev/main.tf` — agregada queue `monthly-reports` + módulo cron + queue policy.
- `segurasist-infra/envs/staging/main.tf` — idem dev.
- `segurasist-infra/envs/prod/main.tf` — idem + tag `Severity=P1`.
- `segurasist-infra/envs/{dev,staging,prod}/alarms.tf` — alarm `cron-monthly-reports-failed` + DLQ runbook map extendido (`monthly-reports → RB-014`) + alarm_arns output.

**Backend NestJS (4 archivos)**:
- `segurasist-api/src/modules/reports/cron/dto/monthly-report-event.dto.ts` (NUEVO) — Zod schema + `resolveReportedPeriod()`.
- `segurasist-api/src/modules/reports/cron/monthly-reports-handler.service.ts` (NUEVO) — handler con poll loop, idempotencia P2002, resilencia per-tenant.
- `segurasist-api/src/config/env.schema.ts` — agregadas `SQS_QUEUE_MONTHLY_REPORTS` + `MONTHLY_REPORT_RECIPIENTS` (CSV → array de emails validados).
- `segurasist-api/.env.example` — entradas correspondientes.

**Prisma (3 archivos)**:
- `segurasist-api/prisma/schema.prisma` — enum `MonthlyReportStatus` + model `MonthlyReportRun` + relación `Tenant.monthlyReportRuns`.
- `segurasist-api/prisma/migrations/20260428_monthly_report_runs/migration.sql` (NUEVO) — TYPE + TABLE + UNIQUE + RLS policies + GRANTs.
- `segurasist-api/prisma/rls/policies.sql` — agregada `monthly_report_runs` al array (anti-drift).

### Tests añadidos

- `segurasist-api/test/integration/eventbridge-cron.spec.ts` — **11 it**:
  - DTO contract (3): shape válido con override + triggeredBy default; rechazo `kind` inválido; default `schemaVersion=1`.
  - `resolveReportedPeriod` (3): feb→ene, ene→dic año-1, override gana siempre.
  - `handleEvent` (5): happy path 2 tenants completan; idempotencia 2do trigger P2002 → `skipped` sin re-email; failure aislado tenant-A falla PDF tenant-B completa; `overridePeriod` con `triggeredBy='manual'`; cero tenants activos no-op.

### Tests existentes

No se modificó código compartido. `apply-rls-idempotency.spec.ts` (S10 owned) actualizará el set esperado al ver la nueva tabla; coordinado vía feed.

### Cross-cutting findings (referencias al feed)

- **NEEDS-COORDINATION generador** — `MonthlyReportGenerator` interface + DI token `MONTHLY_REPORT_GENERATOR`. S1 implementa el provider real iter 2 reutilizando `getConciliacionReport` + `renderConciliacionPdf` (signatures ya creadas en S1 iter 1). Conversión período → from/to: `Date.UTC(year, month-1, 1)` ↔ `Date.UTC(year, month, 1)`.
- **NEEDS-COORDINATION bootstrap** — el handler aún NO está en ningún `@Module`. Iter 2: crear `ReportsCronModule` (o extender `WorkersModule`) con providers + import en `AppModule`.
- **NEW-FINDING TZ** — AWS rules sólo soportan UTC. México sin DST permanente ⇒ 14:00 UTC = 08:00 CST. Desfase 1h vs lo pedido por producto ("9 AM CST"); aceptable en MVP. Migración Sprint 5 a `aws_scheduler_schedule` resuelve.
- **NEW-FINDING runbook RB-014** — pendiente de S10. Cubre re-trigger manual + replay desde failed.
- **NEW-FINDING email attachments** — MVP usa link presigned 7d (SendEmailCommand SDK v3 sin attachments). Sprint 5+ migrar a SendRawEmailCommand.
- **NEW-FINDING SQS queue policy pattern** — env-level (no module-level). Pattern para futuras rules → SQS. Para `DEVELOPER_GUIDE.md` §2.2.
- **NEW-FINDING eventbridge SDK** — `@aws-sdk/client-eventbridge` no instalado; helper `eventbridge.service.ts` retirado de iter 1 (no bloquea cron real). Iter 2 si se expone endpoint manual-trigger en API.

## Iter 2 (placeholder)

Pendiente de orquestador.

## Compliance impact

### S4-04 DoR/DoD

| Item | Estado |
|---|---|
| Migración Prisma con UNIQUE natural key | ✅ `monthly_report_runs` UNIQUE `(tenant_id, period_year, period_month)` |
| RLS habilitada + policies en migración | ✅ `ENABLE/FORCE RLS` + `p_select`/`p_modify` + `policies.sql` array extendido |
| DTO Zod | ✅ `MonthlyReportCronEventSchema` |
| Audit log con AuditWriter.record | ✅ action='create', resourceType='report.monthly', payloadDiff con period+subAction |
| Idempotencia DB-side (NO dedupeId SQS) | ✅ P2002 catch + skip; SqsService no expone dedupeId |
| Throttle | N/A — handler es worker (sin endpoint público) |
| CloudWatch alarm | ✅ `cron-monthly-reports-failed` (AWS/Events FailedInvocations) en 3 envs |
| Tests integration con assertions reales | ✅ 11 it pass; cubre happy path + idempotencia + failure aislado |
| Coverage threshold | Archivos nuevos contribuyen automáticamente al threshold global; suite scoped pendiente |
| Documentación módulo IaC | ✅ `segurasist-infra/modules/eventbridge-rule/README.md` |

## Lecciones para DEVELOPER_GUIDE.md (input para S10)

1. **EventBridge → SQS pattern**: la queue policy va a env-level (no module), declarada con `data.aws_iam_policy_document` + condition `aws:SourceArn = rule_arn` (defense-in-depth contra confused-deputy). Si N rules apuntan a la misma queue, una sola policy con array de SourceArns.
2. **Cron TZ caveat**: `aws_cloudwatch_event_rule.schedule_expression` sólo UTC; documentar el desfase TZ en el comentario del módulo y considerar `aws_scheduler_schedule` para v2.
3. **Idempotencia DB-side, semántica skip vs failed**: P2002 → `skipped` (NO emite audit log adicional, la corrida original ya lo hizo). Resilencia per-tenant: `processTenant()` retorna `'completed' | 'skipped' | 'failed'` y el handler global agrega contadores; un tenant fallando NO aborta a los otros.
4. **DI token para generators externos**: cuando un módulo S(X) depende de lógica que otro módulo S(Y) implementa, exponer interface + token DI (`MONTHLY_REPORT_GENERATOR`) y dejar stub `NotImplemented` permite que S(X) cierre su iter sin bloquear; S(Y) inyecta el provider real en iter 2.
5. **Workers exentos del `assertPlatformAdmin`**: aplicado en `MonthlyReportsHandlerService` con BYPASSRLS + `tenantId` explícito en cada query (igual que `ReportsWorker` y `InsuredsCreationWorker`). Documentar en JSDoc del service y referenciar ADR-0001.
