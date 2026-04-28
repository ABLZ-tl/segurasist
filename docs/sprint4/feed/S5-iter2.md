# S5 — Iter 2 feed

Backend Senior NLP/KB. Iter 2 = consolidación enum AuditAction + integración personalización + cross-tenant fixtures.

## Entradas

[S5] 2026-04-28 09:00 iter2 STARTED docs/sprint4/feed/S5-iter2.md — arrancando consolidación follow-ups (audit enum, kb.service migration, cross-tenant fixture, coordinación S6).

[S5] 2026-04-28 09:30 iter2 DONE prisma/migrations/20260429_audit_action_sprint4_extend/migration.sql — migración unificada agrega 5 valores al enum `audit_action` con `ALTER TYPE ADD VALUE IF NOT EXISTS`: `chatbot_message_sent`, `chatbot_escalated`, `report_generated`, `report_downloaded`, `monthly_report_sent`. Fecha 20260429 garantiza orden post `20260428_audit_action_enum_extend` (Sprint 3 H-01) y `20260428_monthly_report_runs` (S3). Cierra **NEW-FINDING-S10-03** + el finding S5 iter1 sobre workaround `payloadDiff.event` + el finding S6 iter1 sobre `subAction='escalated'`.

[S5] 2026-04-28 09:32 iter2 DONE prisma/schema.prisma:189 — extendido enum `AuditAction` con los 5 nuevos valores. JSDoc del enum actualizado documentando ambas migraciones (Sprint 3 H-01 + Sprint 4 S10) y mapeando cada valor al caller que lo migrará.

[S5] 2026-04-28 09:35 iter2 DONE src/modules/audit/audit-writer.service.ts:62 — `AuditEventAction` extendido con los 5 nuevos literals. JSDoc documenta plan de migración por agente (S5 ya migró; S1/S3/S6 pendientes en sus iter 2). Cast bridge `event.action as unknown as Prisma.AuditLogCreateInput['action']` agregado para sobrevivir hasta el próximo `prisma generate` en CI — colapsable a identidad post-deploy.

[S5] 2026-04-28 09:40 iter2 DONE src/modules/chatbot/kb.service.ts — `KbService.processMessage` migrado: `action: 'create'` + `payloadDiff.event='chatbot.message'` ⇒ `action: 'chatbot_message_sent'` (sin `event` en payloadDiff). JSDoc del service actualizado. Queries SQL "todos los turns del chatbot del último mes" ahora son `WHERE action='chatbot_message_sent'` sin scan de JSON. // for-S10: validar en E2E suite que ya no aparece `event:'chatbot.message'`.

[S5] 2026-04-28 09:50 iter2 DONE test/integration/chatbot-kb.spec.ts — 3 ajustes:
  1. Aserción audit migrada a `action:'chatbot_message_sent'` + verifica que `payloadDiff.event` YA NO se emite (regression guard contra workaround iter 1).
  2. NUEVO `describe('cross-tenant — KB de TENANT_A invisible al insured de TENANT_B (S10 fixture)')` con 3 it: insured A → KB-A only; insured B → KB-B only; regression guard que el `where` de `findMany` mantiene los filtros `enabled+status+deletedAt` (si alguien los quita, RLS no es suficiente con clientes bypass).
  3. Markers explícitos `'TENANT_A — ...'` / `'TENANT_B — ...'` en answer para detectar leak no-mockeado.

[S5] 2026-04-28 09:55 iter2 NEEDS-COORDINATION src/modules/chatbot/escalation.service.ts (S6 OWNED) — S6 puede ahora migrar:
  - `action: 'update'` + `payloadDiff.subAction='escalated'` ⇒ `action: 'chatbot_escalated'` (enum value ya disponible post `20260429_audit_action_sprint4_extend`).
  - Idempotency: `ChatConversation.status='escalated'` (S5 ya creó el modelo + RLS en migración `20260427_chatbot_kb`). Reemplaza la ventana 60min sobre `ChatMessage.escalated` (más estricto: una sola escalación viva por conversation; cron de re-open la mueve a `active`). Pseudocódigo: `prisma.chatConversation.update({where:{id, status:'active'}, data:{status:'escalated'}, ...}).catch(P2025=>alreadyEscalated)`.
  - **DECISIÓN S6**: si prefiere mantener la ventana 60min (más simple, `ChatMessage` ya queda enriquecido con `escalated:true`), respeta; el enum value sigue disponible para cuando quiera migrar. Esta entrada del feed deja la opción documentada — NO bloqueo de S5.
  // for-S6 iter 2

[S5] 2026-04-28 09:58 iter2 NEW-FINDING test/security/cross-tenant.spec.ts — el HTTP_MATRIX iter 1 ya cubre los 3 endpoints S4-06 (`GET /v1/admin/chatbot/kb`, `GET .../kb/:id`, `PATCH .../kb/:id`). Sin entries adicionales necesarias en iter 2: el fixture S10 que pidió cross-tenant a nivel de mensaje (`POST /v1/chatbot/message` insured A → solo KB-A) queda cubierto a nivel **service** en `chatbot-kb.spec.ts` (defense-in-depth) + el gate RLS-layer ya genérico de la suite. Si en iter 3 S0 quiere E2E con BD viva, agregar a `e2e/sprint4-features.e2e-spec.ts` (S10 owned). // info-only

[S5] 2026-04-28 10:00 iter2 NEW-FINDING typecheck — 0 errores en archivos owned (`kb.service.ts`, `audit-writer.service.ts`, `chatbot-kb.spec.ts`); 2 errores remanentes en `auth.service.spec.ts` son pre-existing F1 (no owned por S5). // for-F1 iter 2

[S5] 2026-04-28 10:05 iter2 NEW-FINDING migración bridge cast — el cliente Prisma local NO se regenera en este sandbox (sin `prisma generate`); el cast `event.action as unknown as Prisma.AuditLogCreateInput['action']` es bridge hasta CI corra generate. Una vez deployed, follow-up trivial: borrar el cast (TS lo aceptará como identidad). Misma estrategia que F6 iter 2 usó para los valores del Sprint 3. // info-only post-deploy

[S5] 2026-04-28 10:10 iter2 iter2-complete docs/sprint4/feed/S5-iter2.md — 1 migration nueva, 4 archivos modificados (schema.prisma + audit-writer.service.ts + kb.service.ts + chatbot-kb.spec.ts), 3 tests añadidos al suite cross-tenant fixture, 1 regression guard en aserción audit. NO modifico escalation.service.ts (S6 owned); coordinación dejada en feed con decisión opcional. NO modifico HTTP_MATRIX (cobertura iter 1 ya suficiente).

## Resumen tabular files iter 2

| Path | Tipo | Cambio |
|---|---|---|
| `prisma/migrations/20260429_audit_action_sprint4_extend/migration.sql` | NUEVO | 5 ALTER TYPE ADD VALUE |
| `prisma/schema.prisma` | MOD | enum AuditAction +5 valores + JSDoc |
| `src/modules/audit/audit-writer.service.ts` | MOD | `AuditEventAction` +5 + cast bridge |
| `src/modules/chatbot/kb.service.ts` | MOD | `chatbot_message_sent` (no más `event` workaround) |
| `test/integration/chatbot-kb.spec.ts` | MOD | aserción migrada + 3 tests cross-tenant fixture |
| `docs/sprint4/feed/S5-iter2.md` | NUEVO | (este) |
| `docs/sprint4/S5-report.md` | EXTENDIDO | sección Iter 2 |

## Coordinación con otros agentes

- **S6**: opción de migrar `action='chatbot_escalated'` + `ChatConversation.status` idempotency en su iter 2. Decisión libre — el enum value y el modelo ya están disponibles.
- **S1**: `report_generated` y `report_downloaded` ya disponibles para `reports.controller.ts` iter 2 (puede dejar `read_viewed` legacy si prefiere coexistencia).
- **S3**: `monthly_report_sent` ya disponible para `monthly-reports-handler.service.ts` iter 2 (reemplaza `action='create'`+`resourceType='report.monthly'`).
- **S10**: cierra **NEW-FINDING-S10-03** (migration unificada). Cross-tenant fixture S5+S6 quedó cubierto a nivel service (no bloquea sello DoD iter 2).
- **F1**: typecheck reporta 2 errores pre-existing en `auth.service.spec.ts` (no S5 owned).
