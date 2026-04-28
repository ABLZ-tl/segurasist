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
