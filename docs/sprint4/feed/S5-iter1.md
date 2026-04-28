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
