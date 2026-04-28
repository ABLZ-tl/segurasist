# Sprint 4 Report — S4 Frontend Senior Chatbot UI

**Bundle**: S4-05 chatbot widget portal (5 pts) + S4-08 escalamiento UI (3 pts) = **8 pts**.

**Periodo cubierto**: Iter 1 (este reporte). Iter 2 pendiente.

## Iter 1

### Historias cerradas

- **S4-05** — Widget chatbot embebido en portal asegurado, mobile-first, persistente entre páginas via `localStorage`. FAB en esquina inferior derecha (50x50 mobile / 60x60 desktop, sobre el bottom-nav respetando safe-area-inset-bottom). Drawer full-width 80vh en mobile, floating card 380x540 con backdrop blur en desktop. Mensaje de bienvenida, bubbles diferenciadas usuario/bot/system, timestamps relativos, typing indicator, auto-scroll, Esc cierra, A11y completa (`aria-modal`, `aria-labelledby`, `aria-live="polite"` en lista de mensajes).
- **S4-08** — Botón "Hablar con un humano" siempre visible en el footer (no escondido en overflow), spinner con `aria-busy` mientras la mutation corre, banner de "Ticket TK-xxx creado" tras éxito, botón se deshabilita para evitar tickets duplicados, toast.success con folio. Validación previa: si no hay `conversationId` (asegurado abrió el widget sin escribir nada), no se invoca backend y se muestra toast "Envía primero un mensaje".

### Files creados (10)

| Path | Tipo | LOC aprox |
|---|---|---|
| `segurasist-web/packages/api-client/src/hooks/chatbot.ts` | Hooks RQ mutations | 80 |
| `segurasist-web/packages/api-client/test/chatbot.test.ts` | Tests hooks | 130 |
| `segurasist-web/apps/portal/components/chatbot/chatbot-store.ts` | Zustand store + persist | 130 |
| `segurasist-web/apps/portal/components/chatbot/chatbot-widget.tsx` | Widget root | 240 |
| `segurasist-web/apps/portal/components/chatbot/chatbot-message.tsx` | Bubble (3 variantes) | 110 |
| `segurasist-web/apps/portal/components/chatbot/chatbot-input.tsx` | Footer textarea+send+escalate | 120 |
| `segurasist-web/apps/portal/components/chatbot/chatbot-typing-indicator.tsx` | Indicator 3 dots | 50 |
| `segurasist-web/apps/portal/components/chatbot/index.ts` | Barrel | 12 |
| `segurasist-web/apps/portal/app/api/chatbot/route.ts` | POST proxy /v1/chatbot/message | 35 |
| `segurasist-web/apps/portal/app/api/chatbot/escalate/route.ts` | POST proxy /v1/chatbot/escalate | 25 |
| `segurasist-web/apps/portal/test/integration/chatbot-widget.spec.ts` | Integration spec | 290 |

### Files modificados (2)

- `segurasist-web/apps/portal/app/(app)/layout.tsx` — sustituido `ChatFab` placeholder por `<ChatbotWidget />`.
- `segurasist-web/packages/api-client/package.json` — agregado `"./hooks/chatbot"` al campo `exports`.

### Tests añadidos: 17

- **`packages/api-client/test/chatbot.test.ts`** (6 it):
  - `useSendChatMessage` con `conversationId` → POST `/api/proxy/v1/chatbot/message` body `{message, conversationId}`.
  - `useSendChatMessage` sin `conversationId` → body `{message}`.
  - `useSendChatMessage` 500 → mutation rechaza con `ProblemDetailsError`.
  - `useEscalateConversation` con `reason` → POST `/api/proxy/v1/chatbot/escalate` body `{conversationId, reason}`.
  - `useEscalateConversation` sin `reason` → body `{conversationId}`.
  - `useEscalateConversation` 429 → mutation rechaza.

- **`apps/portal/test/integration/chatbot-widget.spec.ts`** (11 it):
  - render inicial: FAB visible, panel oculto, 0 fetches.
  - click FAB abre dialog con `aria-modal`, mensaje de bienvenida visible.
  - escribir + Send → POST con body correcto + user bubble + bot bubble.
  - Enter envía / Shift+Enter newline.
  - escalate sin conversación → no llama backend.
  - escalate con conversación → POST `/escalate` + banner ticket + botón disabled.
  - error 503 send → system bubble in-line + user bubble preservado.
  - persistencia localStorage `sa.portal.chatbot.v1` (conversationId + messages).
  - Esc cierra panel.
  - A11y: `aria-modal=true`, `aria-labelledby="sa-chatbot-title"`, `aria-live="polite"` en lista.
  - `enabled=false` → empty render.

### Resultados de tests

- **`packages/api-client`**: 9 archivos / **51 tests / 51 pass**. (`chatbot.test.ts` 6/6).
- **`apps/portal`**: 13 archivos / **88 tests / 88 pass**. (`chatbot-widget.spec.ts` 11/11).
- **Typecheck**: `pnpm tsc --noEmit` clean en ambos paquetes.

### Cross-cutting findings (referencias al feed)

- `[S4] iter1 NEW-FINDING shape /v1/chatbot/message` — Tipos en `ChatMessageReply` con index signature `[extra:unknown]` + opcionales `policyExpiresAt`, `packageName` para que S5/S6 puedan extender response sin breakage. **for-S5 for-S6**.
- `[S4] iter1 NEW-FINDING dedicated routes vs catchall` — Rutas `/api/chatbot` y `/api/chatbot/escalate` reusan `makeProxyHandler` pero los hooks rutean por `/api/proxy/v1/chatbot/*`. Decisión arquitectural pendiente para iter 2: ¿migrar hooks a paths dedicados (gana métricas dedicadas) o eliminar las dedicadas (gana DRY)? **for-S0**.
- `[S4] iter1 NEW-FINDING ChatFab placeholder removido del layout` — `components/layout/chat-fab.tsx` quedó huérfano. No lo eliminé (no está en files OWNED). **for-S10 cleanup**.
- `[S4] iter1 NEW-FINDING auth gate` — Widget montado bajo `(app)/layout.tsx`, ya protegido por `apps/portal/middleware.ts`. Sin chequeo runtime extra. Prop `enabled` reservado para feature-flag futuro. **info-only**.

## Iter 2 (pendiente)

### Follow-ups esperados del feed

- Cuando S5 publique el DTO definitivo de `/v1/chatbot/message` (probables campos: `intent`, `confidence`, `sources[]`), refinar `ChatMessageReply` y opcionalmente pintar:
  - sub-bubble con "Fuentes: PDF póliza p.12" si llega `sources[]`.
  - chip "Confianza: 92%" para feedback transparente al asegurado.
- Cuando S6 publique personalization (`policyExpiresAt`, `packageName`, `pendingClaims`), añadir un panel de contexto colapsable encima de la conversación ("Tu póliza vence en 23 días — Paquete Plus").
- Decidir con S0 si los hooks migran a `/api/chatbot` y `/api/chatbot/escalate` directos (entonces eliminar el routing por `/api/proxy/v1/chatbot/*` para ese subset).

### Coordinaciones esperadas

- **S5 (KB)** — alinear formato de error: ¿qué status devuelve el backend cuando la KB no encuentra match? Hoy asumo 200 con `reply` de fallback; si devuelve 422, el catch del widget ya maneja system bubble + toast pero sería más limpio tipar `LowConfidenceReply`.
- **S6 (personalization + escalation)** — confirmar shape de `/v1/chatbot/escalate` response. Hoy uso `{ticketId, status, ackEmailQueued}`; si S6 agrega `slaHours` o `assignedTo`, lo pinto en el banner.
- **S10 (QA)** — el integration spec usa `userEvent` + jsdom (no E2E real); E2E con Playwright queda para `tests/e2e/sprint4-features.e2e-spec.ts` (owner S10).

## Compliance impact

### S4-05 — DoR/DoD

| Criterio | Estado |
|---|---|
| Mobile-first (≥44dp tap targets, safe-area, full-width drawer) | ✅ |
| A11y (aria-modal, aria-labelledby, aria-live, focus management, Esc) | ✅ |
| Auth (widget solo en `(app)/`, redirección por middleware) | ✅ |
| Persistencia entre páginas (localStorage TTL 7d) | ✅ |
| Loading states (typing indicator, send button disabled, aria-busy) | ✅ |
| Error handling (toast.error + system bubble, retry implícito al re-enviar) | ✅ |
| Tests TDD primero (chatbot.test.ts antes que hooks) | ✅ |
| Coverage scoped contribuye a 60/55/60/60 | ✅ (archivos nuevos cubiertos por integration spec) |

### S4-08 — DoR/DoD

| Criterio | Estado |
|---|---|
| Botón "hablar con humano" visible y accesible | ✅ |
| Llama POST `/v1/chatbot/escalate` con `conversationId` | ✅ |
| UI feedback "ticket creado" con folio | ✅ banner + toast.success + system bubble |
| Backend (envío correo MAC + acuse asegurado) | OUT-OF-SCOPE (owner S6) |
| Doble click bloqueado (botón disabled tras éxito) | ✅ `escalateDisabled` |
| Validación previa (no escalar sin conversación) | ✅ toast informativo |

## Lecciones para `DEVELOPER_GUIDE.md` (sugerencias para S10)

1. **Widgets globales de portal van bajo `(app)/layout.tsx`, no en página individual.** El layout es Server Component y monta el widget Client Component una sola vez; React Query + zustand sobreviven al `<Link>` navigation porque el layout no se desmonta.
2. **Pattern para rutas API estáticas que reutilizan `makeProxyHandler`**: pasar context fake `{params:{path:[…]}}`. Documentar trade-off vs catchall (granularidad de métricas vs DRY).
3. **Persistencia client-only opcional con zustand**: NO usar middleware `persist` cuando se quiere TTL + capa anti-bloat + schema versionado. Manual `read/writePersisted` es ~30 líneas y deja control total para invalidar caches viejos sin migrar el shape.
4. **Hooks de mutation que aceptan shape evolutivo (S5/S6)**: tipar response con `[extra: unknown]` index signature + campos opcionales. El cliente no se rompe si backend agrega keys; cuando S5/S6 firmen el DTO, refinar tipos sin tocar widgets.
5. **Test de widget con mock de fetch global** (no MSW): mismo patrón que `insured-flow.spec.ts`. Helper `setupFetchMock(handler)` por archivo, restore en `afterEach`. Cubre path/verbo/body/headers — más que suficiente para chatbot.

## Métricas iter 1

- **Pts entregados**: 8 / 8 (100%).
- **Files OWNED tocados**: 12 / 12 (incluido `package.json` admin de export).
- **Files READ-ONLY respetados**: ✅ (ningún cambio fuera de OWNED list).
- **Reglas absolutas**: cookie via `@segurasist/security`, no docker, no commits, tests primero, no `it.todo`.
- **Throttle**: N/A en frontend; el backend (S5/S6) lo aplicará vía `@Throttle` en sus controllers.
