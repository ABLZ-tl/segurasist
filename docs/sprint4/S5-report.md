# Sprint 4 Report — S5 (Backend Senior NLP/KB)

Bundle: **S4-06** Knowledge base estructurada por categorías + matching engine + admin CRUD multi-tenant. 8 puntos.

## Iter 1

### Historias cerradas
- **S4-06** ✅ KB structure + keyword matching + synonyms + admin CRUD.

### Files creados / modificados (count + paths)

**Backend API — created (10):**
- `segurasist-api/src/modules/chatbot/chatbot.controller.ts`
- `segurasist-api/src/modules/chatbot/kb.service.ts`
- `segurasist-api/src/modules/chatbot/kb-matcher.service.ts`
- `segurasist-api/src/modules/chatbot/dto/chat-message.dto.ts`
- `segurasist-api/src/modules/chatbot/dto/kb-entry.dto.ts`
- `segurasist-api/prisma/migrations/20260427_chatbot_kb/migration.sql`
- `segurasist-api/seed/chatbot-kb-seed.ts`
- `segurasist-api/test/integration/chatbot-kb.spec.ts`
- `docs/sprint4/feed/S5-iter1.md`
- `docs/sprint4/S5-report.md`

**Backend API — modified (5):**
- `segurasist-api/prisma/schema.prisma` — añadido enum `ChatConversationStatus`, modelo `ChatConversation`, relaciones a Tenant; extendidos `ChatKb` (keywords, synonyms, priority, enabled) y `ChatMessage` (conversationId, role, matchedEntryId).
- `segurasist-api/prisma/rls/policies.sql` — `chat_conversations` agregado al array canónico.
- `segurasist-api/src/modules/chatbot/chatbot.module.ts` — registró `KbService`, `KbMatcherService`, `ChatbotController`, `AdminChatbotKbController`.
- `segurasist-api/src/app.module.ts` — `ChatbotModule` registrado.
- `segurasist-api/test/security/cross-tenant.spec.ts` — 3 entries nuevas al HTTP_MATRIX.

### Tests añadidos
- `test/integration/chatbot-kb.spec.ts` (14 it):
  - `KbMatcherService.tokenize` (3): lowercase+acentos+stop-words; idempotencia; vacío.
  - `KbMatcherService.findBestMatch` (5): no-match → null; keyword directa; sinónimo; tie-break priority; tie-break orden.
  - `KbService.processMessage` (3): match + personalización + audit; no-match → escalation; escalation lanza → fallback graceful.
  - `KbService` CRUD (4): create defaults; update 404; delete soft-delete; list filtros + orderBy.
- `test/security/cross-tenant.spec.ts` HTTP_MATRIX +3:
  - `GET /v1/admin/chatbot/kb`
  - `GET /v1/admin/chatbot/kb/:id`
  - `PATCH /v1/admin/chatbot/kb/:id`

### Tests existentes
- ✅ Typecheck `npx tsc --noEmit` — 0 errores en archivos owned.
- ⚠️ Pre-existing 7 errors en `src/modules/auth/auth.service.spec.ts` (no owned por S5).
- ❌ Suite scoped no ejecutada: el sandbox del harness rechaza `jest`/`pnpm test`. Bloqueador del entorno; el spec compila limpio y los assertions están escritos contra mocks deep — listo para que el orquestador corra `pnpm test:integration -- chatbot-kb` y `pnpm test:cross-tenant`.

### Cross-cutting findings
- **Audit action**: usé `action: 'create'` + `resourceType: 'chatbot.message'` + `payloadDiff.event='chatbot.message'` en lugar de extender el enum `AuditAction`. Razón: per DEVELOPER_GUIDE 2.5, extender enum requiere migración `ALTER TYPE ADD VALUE` y coordinación con F6/S6. Iter2 podemos formalizar `chatbot_message` como valor dedicado para queries SQL más eficientes.
- **EscalationService ownership**: S6 ya escribió `escalation.service.ts` completo (notificaciones SES + idempotency + audit). Lo dejé sin tocar y el `KbService` lo consume vía DI opcional (firma `escalate(insuredId, conversationId, reason)` ya acordada en el plan).
- **Modelos preexistentes ChatMessage/ChatKb**: en lugar de duplicar, los extendí con columnas faltantes. Migración `20260427_chatbot_kb` es idempotente (`ADD COLUMN IF NOT EXISTS`) — re-aplicable sin romper.
- **Personalization fail-soft**: `KbService.processMessage` invoca `PersonalizationService.fillPlaceholders` con try/catch — si S6 throws (insured not found, BD glitch), entregamos el template literal al insured y logueamos warn. Mejor UX que romper la respuesta del bot.
- **Throttle**: `@Throttle({ttl:60_000, limit:30})` en POST /v1/chatbot/message — el widget UX humano promedia 6 msg/min; 30/min deja margen + bloquea scraping.

### DoR/DoD checklist (S4-06)
- [x] DoR: historia con criterios; dependencias S6 acordadas
- [x] Tests primero: spec con 14 assertions reales (no `it.todo`).
- [x] DTOs Zod — `ChatMessageSchema`, `CreateKbEntrySchema`, `UpdateKbEntrySchema`, `ListKbEntriesQuerySchema`.
- [x] @ApiTags Swagger en ambos controllers.
- [x] @Roles RBAC explícito (`insured` en message; `admin_mac`/`admin_segurasist`/`supervisor` en CRUD; `supervisor` solo lectura).
- [x] @Throttle en POST /v1/chatbot/message (30/min).
- [x] AuditContextFactory.fromRequest(req) en todo audit log.
- [x] RLS — 3 tablas (chat_conversations nuevo + chat_messages, chat_kb extendidos) en migración + array `policies.sql`.
- [x] Cross-tenant test — 3 entries añadidas al HTTP_MATRIX.
- [x] Typecheck limpio en archivos owned.
- [ ] `pnpm test` execution — bloqueado por sandbox; tests escritos y compilan.

## Iter 2 — Consolidación enum AuditAction + cross-tenant fixtures + coordinación S6

### Trabajos cerrados

1. **Migration unificada `20260429_audit_action_sprint4_extend`** (NUEVA). 5 valores nuevos al enum `audit_action`:
   - `chatbot_message_sent` — S5 (este iter migra el caller).
   - `chatbot_escalated` — S6 (decisión libre en su iter 2; valor disponible).
   - `report_generated` — S1 (decisión libre; valor disponible).
   - `report_downloaded` — S1 (decisión libre; valor disponible).
   - `monthly_report_sent` — S3 (decisión libre; valor disponible).

   Cierra **NEW-FINDING-S10-03** + alinea con findings S5 iter1 (`payloadDiff.event` workaround) y S6 iter1 (`subAction='escalated'`). Idempotente con `ALTER TYPE ADD VALUE IF NOT EXISTS`.

2. **`prisma/schema.prisma`** — enum `AuditAction` extendido con los 5 valores; JSDoc actualizado documentando ambas migraciones (Sprint 3 H-01 + Sprint 4 S10) y el plan de migración por agente.

3. **`src/modules/audit/audit-writer.service.ts`** — `AuditEventAction` (type union) extendido con los 5 valores. Bridge cast `event.action as unknown as Prisma.AuditLogCreateInput['action']` agregado para coexistir con cliente Prisma sin re-generar (sandbox-safe; CI corre `prisma generate`).

4. **`src/modules/chatbot/kb.service.ts`** — `KbService.processMessage` migrado: ahora emite `action: 'chatbot_message_sent'` (sin `payloadDiff.event`). Queries SQL "todos los turns del chatbot del último mes" sin scan de JSON.

5. **`test/integration/chatbot-kb.spec.ts`** — 3 cambios:
   - Aserción audit migrada al nuevo enum value + regression guard que `payloadDiff.event` YA NO se emite.
   - Nuevo `describe('cross-tenant — KB de TENANT_A invisible al insured de TENANT_B (S10 fixture)')` con 3 it (insured A → KB-A only, insured B → KB-B only, regression guard del where clause).

6. **Cross-tenant HTTP_MATRIX** — sin cambios; las 3 entries S4-06 añadidas en iter 1 cubren el gate HTTP-layer. El nuevo gate service-layer + RLS-layer existente proveen defense-in-depth.

### Files modificados iter 2 (count + paths)

- **NUEVO** (2): `prisma/migrations/20260429_audit_action_sprint4_extend/migration.sql`, `docs/sprint4/feed/S5-iter2.md`.
- **MOD** (4): `prisma/schema.prisma`, `src/modules/audit/audit-writer.service.ts`, `src/modules/chatbot/kb.service.ts`, `test/integration/chatbot-kb.spec.ts`.
- **EXTENDIDO** (1): `docs/sprint4/S5-report.md` (este).

### Tests añadidos iter 2

`test/integration/chatbot-kb.spec.ts` `describe('cross-tenant — KB de TENANT_A invisible…')`:
1. Insured A → `prisma.chatKb.findMany` mock devuelve solo KB-A (RLS context A); response contiene marker `TENANT_A`, NUNCA `TENANT_B`; audit con `tenantId=A, action='chatbot_message_sent'`.
2. Insured B → mismo patrón inverso.
3. Regression guard — el `where` del `findMany` mantiene `enabled+status+deletedAt`, sin ello el matcher consumiría drafts/disabled de cualquier tenant.

### Coordinación con S6

`escalation.service.ts` es S6-OWNED. En el feed (`S5-iter2.md`) dejé documentada la opción de:
- migrar `action='update'+subAction='escalated'` ⇒ `action='chatbot_escalated'`;
- migrar la idempotency a `ChatConversation.status='escalated'` (modelo ya creado en `20260427_chatbot_kb`).

Decisión libre de S6 — NO bloquea S5; el enum value y el modelo ya están disponibles.

### Verificación iter 2

- ✅ Typecheck `npx tsc --noEmit -p tsconfig.json` — 0 errores en archivos owned.
- ⚠️ Pre-existing 2 errors en `src/modules/auth/auth.service.spec.ts` (no owned por S5; F1 iter 2).
- ❌ Suite `pnpm test` no ejecutable en sandbox; specs compilan limpio.

### DoD iter 2 checklist

- [x] Migration unificada AuditAction creada (cierra NEW-FINDING-S10-03).
- [x] Schema.prisma actualizado.
- [x] AuditEventAction type extendido.
- [x] kb.service.ts migrado al nuevo enum value (sin `payloadDiff.event` workaround).
- [x] Test del audit call actualizado + regression guard.
- [x] Cross-tenant fixture S10 cubierto a nivel service (3 tests).
- [x] HTTP_MATRIX cross-tenant — sin necesidad de extender (iter 1 ya suficiente).
- [x] Coordinación S6 documentada en feed (decisión libre).
- [x] Feed `S5-iter2.md` cerrado.
- [x] Reporte iter 2 (esta sección).

## Iter 3+ pendiente (backlog Sprint 5)

- [ ] Si S4 (frontend) pide más metadatos en respuesta (e.g. `entryId` para feedback), agregar al `ChatMessageResponse` shape.
- [ ] Hook explícito de keyword "agente"/"humano" → forzar escalation (hoy depende del matcher: si la entry general:asesor tiene priority alta gana — pero podríamos cortocircuitar antes del matcher).
- [ ] Considerar `pg_trgm` similarity para typos (sprint 5).
- [ ] Post-deploy: borrar el bridge cast en `audit-writer.service.ts` cuando `prisma generate` ya regeneró el cliente con los nuevos valores enum.

## Lecciones para DEVELOPER_GUIDE.md
1. **Modelos pre-existentes en schema con columnas TODO**: extender > duplicar. La migración `ADD COLUMN IF NOT EXISTS` permite cohabitar Sprint 1 stubs con campos Sprint 4+ sin romper datos.
2. **EscalationService crossover S5↔S6**: dispatch plan asignó "S5 o S6 — decidir iter1". Coordiné inspeccionando el filesystem antes de escribir; S6 ya tenía la versión robusta. Lección: revisar siempre `ls` del path NEW antes de escribir, otro agente puede haberlo hecho primero.
3. **Audit action enum vs payloadDiff event**: cuando un nuevo dominio (chatbot) emite events, decidir entre extender enum (queries SQL eficientes) o usar `payloadDiff.event` (cero coordinación). Iter1 elegí lo segundo; documentamos como lección + ADR follow-up.
4. **Matcher puro testeable**: el algoritmo `tokenize + scoreEntry + findBestMatch` está sin Prisma → testable sin mocks. Patrón replicable para otros NLP-style services (Sprint 5+ semantic search).
5. **Personalization fail-soft con try/catch**: cuando un service llama otro service que puede degradar (BD/network), preferir best-effort + log.warn antes que propagar — el chat NUNCA debe responder 500 al insured por una falla downstream.
