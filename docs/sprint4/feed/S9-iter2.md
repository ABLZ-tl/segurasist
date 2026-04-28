# S9 — Iter 2 feed

> Append-only. Formato: `[S9] <YYYY-MM-DD HH:MM> <ITER> <STATUS> <file:line> — <descripción> // <impacto>`

## Entradas

[S9] 2026-04-29 10:15 iter2 STARTED docs/sprint4/feed/S9-iter2.md — follow-up consolidado vía S-MULTI: documentar política de extension del enum `audit_action` tras la migración unificada `20260429_audit_action_sprint4_extend` publicada por S5 iter 2.

[S9] 2026-04-29 10:18 iter2 VERIFY segurasist-api/prisma/migrations/20260429_audit_action_sprint4_extend/migration.sql — confirmados 5 nuevos valores: `chatbot_message_sent`, `chatbot_escalated`, `report_generated`, `report_downloaded`, `monthly_report_sent`. Sintaxis idempotente `ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS '...'` × 5 (Postgres 12+). Migración exemplary: comentarios explican por qué 5 valores, qué workaround reemplaza cada uno (S1/S3/S5/S6), y cuál es la planeación cross-sprint para que cada owner migre su service.

[S9] 2026-04-29 10:22 iter2 DECISION ADR-0008 vs ADR-0007 sección — el dispatch S-MULTI ofrecía dos opciones: (a) crear ADR-0008 nueva o (b) agregar sección "Audit enum extension policy" a ADR-0007 existente. **Decisión: opción (a)**. Justificación: ADR-0007 cubre coverage thresholds (un dominio CI/test policy), audit-action es un dominio diferente (BD schema + cross-bundle compliance). Mezclarlos pierde la "1 ADR = 1 decisión" del registry pattern; reviewers buscando "audit policy" no encuentran nada en `ADR-0007-coverage-thresholds`. Crear ADR-0008 mantiene la legibilidad del registry y facilita el cross-link desde el DEVELOPER_GUIDE §2.5.

[S9] 2026-04-29 10:30 iter2 DONE docs/adr/ADR-0008-audit-action-enum-extension.md — ADR nueva (~180 líneas) cubriendo: (1) Context con los 4 NEW-FINDINGs Sprint 4 que motivaron la migración consolidada; (2) Decision con 6 sub-policies (cuándo extender, cómo extender, coordinación cross-bundle, cuándo SÍ usar payloadDiff.subAction, anti-rollback, audit del audit); (3) Consequences positive + negative honestas (PG enum cache reload, coordination overhead, cross-sprint debt explícita para S1/S3/S6); (4) 5 alternativas rechazadas con razones técnicas (por-bundle migrations, columna paralela, solo payloadDiff, string libre, event-sourcing); (5) Follow-ups Sprint 5/6/7 con criterios objetivos de re-evaluación.

[S9] 2026-04-29 10:33 iter2 NEW-FINDING cross-sprint debt explícita — la migración unificada introdujo los 5 valores pero solo S5 iter 2 ya los consume (`chatbot_message_sent`). S1, S3, S6 mantienen el workaround (`action='create'+payloadDiff.subAction='X'`). ADR-0008 §Follow-ups Sprint 5 lista los 3 ítems de migración pendientes:
- S1 reports → `action='report_generated'` para PDF/XLSX render path.
- S3 monthly cron → `action='monthly_report_sent'` (hoy `create`+subAction).
- S6 escalation → `action='chatbot_escalated'` (hoy `update`+subAction).

S10 debería incluir estos 3 en la matriz DoD Sprint 5 (gate D5) para que no se pierdan en backlog. // for-S10 + for-Sprint-5 owners

[S9] 2026-04-29 10:36 iter2 NEW-FINDING DEVELOPER_GUIDE.md §2.5 cheat-sheet — la sección actual lista valores enum existentes pero NO los 5 nuevos. Sprint 5 (S10 owner DEVELOPER_GUIDE) debe agregar una matriz dominio → valor (chatbot/escalate/report/monthly_report) con ejemplo de payloadDiff esperado por cada uno, y un comment "ver ADR-0008 para policy de extensión". // for-S10 Sprint 5

[S9] 2026-04-29 10:38 iter2 NEW-FINDING lint-audit-actions.sh — la ADR-0008 §Follow-ups Sprint 5 propone un script CI que detecte `payloadDiff.subAction = '<x>'` donde `<x>` ya es valor válido del enum y warning de migración. Implementación trivial (grep+jq sobre ts files); valor: previene regresión al patrón fragmentado tras los cleanups de S1/S3/S6. Sprint 5 backlog item para S9 o F8. // for-Sprint-5

[S9] 2026-04-29 10:40 iter2 iter2-complete — ADR-0008 publicada con policy completa de audit_action enum extension. La migración S5 unificada queda formalmente justificada + documentada. 3 ítems de cross-sprint debt flagged como Sprint 5 hard deadline.
