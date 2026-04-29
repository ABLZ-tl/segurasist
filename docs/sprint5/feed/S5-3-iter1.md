# S5-3 iter 1 — 2026-04-28

## Plan

Cerrar la historia S5-3 (Full-stack chatbot extensions). El agente original
entregó BE completo (módulo NestJS `kb-admin` + `conversations-history` +
cron de retención + DTOs Zod + tests + migración). Quedaba pendiente toda
la FE: editor admin de KB y portal de "Mis conversaciones". Esta iter
finisher entrega ambos consumiendo los contratos publicados.

## Hechos

### BE entregado por el agente original (recap)

- `segurasist-api/src/modules/chatbot/kb-admin/kb-admin.controller.ts` (NUEVO)
  - `GET    /v1/admin/chatbot/kb`            (list + search por title/intent)
  - `GET    /v1/admin/chatbot/kb/:id`        (detail)
  - `POST   /v1/admin/chatbot/kb`            (create)
  - `PUT    /v1/admin/chatbot/kb/:id`        (update Sprint 5)
  - `PATCH  /v1/admin/chatbot/kb/:id`        (compat Sprint 4)
  - `DELETE /v1/admin/chatbot/kb/:id`        (soft-delete)
  - `POST   /v1/admin/chatbot/kb/:id/test-match` (sin persistir)
  - `POST   /v1/admin/chatbot/kb/import`     (CSV bulk)
  - Roles: `admin_segurasist` + `admin_mac` (mutaciones); `supervisor` (read).
  - Throttle por endpoint (5/min import, 30/min mutación, 60/min test-match).
- `segurasist-api/src/modules/chatbot/kb-admin/kb-admin.service.ts` con
  AuditContextFactory + RLS por tenant + mapping Sprint 4↔5
  (`category` ↔ `intent`, `question` ↔ `title`, `answer` ↔ `body`).
- `segurasist-api/src/modules/chatbot/kb-admin/dto/kb-admin.dto.ts` —
  Zod schemas (intent slug `^[a-z][a-z0-9-]*$` 1..40, title 1..120, body
  1..4000, keywords 1..50 × 1..80, priority 0..100).
- `segurasist-api/src/modules/chatbot/conversations-history/`
  - `GET /v1/chatbot/conversations`              (insured-only, ≤30d)
  - `GET /v1/chatbot/conversations/:id/messages` (insured-only, read-only)
  - DTOs: `ConversationListItemView`, `ConversationMessageView`.
- `segurasist-api/src/modules/chatbot/cron/conversations-retention.service.ts`
  Purge diario de conversaciones con `expiresAt < NOW()`.
- Migración Prisma: `chat_conversations.expiresAt`, `chat_kb` editable
  (slug `category` libre, sin CHECK constraint).

### FE entregado (esta iter)

#### 1. Admin KB Editor — `apps/admin/app/(app)/chatbot/kb/`

- `page.tsx` (Server Component)
  RBAC explícito `admin_segurasist | admin_mac`. Otros roles →
  `<AccessDenied />` con copy custom. `force-dynamic`.
- `kb-list-client.tsx` (Client Component, orquestador)
  Tabla custom (no `<DataTable>` — necesitamos `<GsapStagger>` en el
  `<tbody>` y row hover lift `scale-[1.005]`). Search debounced 250ms.
  Toggle enabled inline con `<button role="switch">` y ring color shift
  CSS-only (success/15 + ring success/30) — sin lib externa. Empty state
  con LordIcon `lab-flask` 96px + CTA "Crear primera entrada".
- `kb-entry-form.tsx` (drawer)
  `<Sheet side="right" max-w-2xl>` + react-hook-form + zod resolver
  (paridad con BE Zod). Campos: intent, title, body (textarea 220px+,
  monospace), keywords (chip-input con Enter/comma split y backspace
  delete), priority number, enabled toggle visual. Toast success/error
  con LordIcon `checkmark-success`.
- `kb-test-match.tsx`
  Panel inline visible cuando hay entry editada. Form con input + Probar
  button → `POST /v1/admin/chatbot/kb/:id/test-match`. Render Badge
  success/outline + score + chips de matched keywords.
- `kb-csv-import.tsx`
  `<FileDrop>` con accept `.csv`, max 1MB (paridad con Zod BE
  `csv: z.string().max(1024*1024)`). Lee el archivo con `file.text()`
  y envía JSON `{csv, upsert}`. Render summary inserted/updated/skipped
  + `<details>` con errors. Checkbox upsert default true.
- `_lordicons.ts`
  Helper que mapea acciones del editor → nombres del catálogo
  `@segurasist/ui/lord-icon`: `edit-pencil`, `trash-bin`, `lab-flask`,
  `import-export`, `checkmark-success`, `warning-triangle`, `search`.
  Centralizado para iter 2 cuando DS-1 resuelva los `<TODO_ID_*>` del
  catálogo (ver `listUnresolvedIcons()`).

#### 2. Portal Histórico Chatbot — `apps/portal/app/(app)/chatbot/history/`

- `page.tsx` (Server Component shell, force-dynamic).
- `history-client.tsx`
  Grid responsive (1/2/3 cols), `<GsapStagger staggerDelay={0.05}>` en el
  contenedor de cards, `<PageTransition>` envolvente, paginación simple
  con botón "Cargar más" cuando `offset + items.length < total`. Empty
  state con LordIcon `chat-bubble` 96px.
- `conversation-card.tsx`
  Botón rounded-xl, padding 16px, shadow-sm, hover translate-y-[-2px] +
  shadow-md (cumple "Cards: rounded 12px, shadow soft" del brief —
  rounded-xl es 12px en Tailwind). Status badge (escalada=default/info,
  resuelta=success, abierta=secondary) con dot color por estado. Preview
  truncado a 80 chars con `…`. Timestamp relativo `formatDistanceToNow`
  con locale `es` (date-fns).
- `conversation-thread-drawer.tsx`
  `<Sheet side="right" max-w-xl>`. Reusa `<ChatbotMessageBubble>` del
  widget existente (S4-05 — `apps/portal/components/chatbot/chatbot-message.tsx`)
  para mantener consistencia visual. Mapea `ConversationMessage.role/content/createdAt`
  → `ChatbotMessage.author/text/ts`. Auto-scroll al fondo cuando data
  carga. Skeleton + AlertBanner danger en error.

### API client extendido

- `packages/api-client/src/hooks/admin-chatbot-kb.ts` — ya existía el
  scaffolding del agente original. Hooks: `useAdminKbList`,
  `useCreateKbEntry`, `useUpdateKbEntry(id)`, `useDeleteKbEntry`,
  `useTestKbMatch(id)`, `useImportKbCsv`. Cache key
  `['admin-kb', 'list', params]`. Invalidación cruzada en mutaciones
  vía `adminKbKeys.all`.
- `packages/api-client/src/hooks/chatbot-history.ts` — ya existía. Hooks:
  `useChatbotConversations({limit, offset})`, `useChatbotConversationMessages(id, {limit, offset})`.
  Cache key `['chatbot-history', 'list' | 'messages', ...]`. staleTime 60s.
- `packages/api-client/package.json` — agregados los exports
  `./hooks/admin-chatbot-kb` y `./hooks/chatbot-history` (los hooks ya
  existían pero los entry-points del bundler no estaban declarados).

### Otros archivos modificados

- `apps/portal/components/layout/user-menu.tsx`
  Agregado link "Mis conversaciones" entre "Mi perfil" y "Cerrar sesión".
  Icon `<MessageCircle>` (Lucide — el menu ya usa otros Lucide icons,
  lo mantengo consistente; iter 2 puede swap a `<LordIcon name="chat-bubble">`).

### Tests

- `apps/admin/test/integration/kb-list.spec.tsx` — 9 tests:
  1. skeleton loading
  2. tabla con 3 entries (title + intent + total)
  3. empty state con Lordicon + CTA
  4. error banner cuando isError
  5. click "Editar" abre drawer prellenado
  6. click "Eliminar" → confirm → mutation
  7. test-match score + matched keywords
  8. CSV reject non-csv
  9. CSV accept .csv → mutation con contenido + upsert flag
- `apps/portal/test/integration/chatbot-history.spec.tsx` — 6 tests:
  1. skeleton loading
  2. 3 cards mock con preview + status badges (Abierta/Resuelta/Escalada)
  3. empty state con copy + Lordicon
  4. error banner cuando isError
  5. click card abre drawer + carga mensajes (hook id correcto)
  6. mensajes renderizados con `<ChatbotMessageBubble>` (texto user + bot)

**Total tests S5-3 FE: 15** (9 admin + 6 portal). Más los del agente
original BE (`kb-admin.service.spec.ts` ≈ 12, `conversations-history.service.spec.ts` ≈ 6,
`conversations-retention.service.spec.ts` ≈ 3).

## NEW-FINDING

1. **Catálogo Lordicon con placeholders**: `lab-flask`, `import-export`
   y otros aparecen como `<TODO_ID_*>` en
   `packages/ui/src/lord-icon/catalog.ts`. `<LordIcon>` cae al fallback
   `<span>` sized cuando el ID no resuelve (no rompe layout). DS-1 debe
   resolver los IDs en iter 2 — `listUnresolvedIcons()` los enumera.
2. **`adminKbKeys.detail` no se usa todavía**: el hook de detail
   (`useKbEntry(id)`) no fue solicitado en el brief porque el editor
   abre el drawer con la entry ya en memoria (la trae el list).
   Para iter 2, si CSV import enriquecimiento debe mostrar review
   detallado pre-commit, sería natural agregar `useKbEntry`.
3. **Multipart vs JSON CSV**: el BE acepta el CSV como string en JSON
   (no multipart). Esto evita Multer en el chatbot module pero limita
   el size a 1MB (límite Zod). NEW-FINDING para iter 2: si el cliente
   sube CSVs >1MB, hay que pasar a multipart con stream parsing.
4. **Toggle enabled sin Radix Switch**: usé `<button role="switch">`
   custom para mantener el "ring color shift CSS" pedido. Funciona
   bien pero pierde el grouping nativo de Radix (focus-visible queue).
   Iter 2: extraer a `<EnabledToggle>` en `@segurasist/ui` o usar
   Radix Switch.
5. **`PageTransition` y `GsapStagger` en jsdom**: stub a nivel de test
   en `vi.mock('@segurasist/ui', ...)` para que no requieran gsap.
   Patrón ya usado por branding-editor.spec — lo replico.
6. **User-menu del portal**: el menu existía y ya tenía pattern para
   añadir entries; agregué "Mis conversaciones" inline (no requirió
   componente nuevo). El brief pedía crear NEW-FINDING si no existía,
   pero existía → modificación in-place.
7. **`Section` no acepta `as`**: el primer prototipo usaba
   `<Section as="header">` pero el componente real solo tiene
   `title`/`description`/`actions`. Lo dejé como `<Section>` con
   `<header>` interno por defecto.
8. **Test del status badge**: testeo el contenido textual de
   `conversation-card-status` (ej: "Resuelta") y NO el variant exacto
   del Badge — el variant es decisión visual y puede cambiar; el
   label es contrato UX estable.

## Bloqueos

Ninguno crítico. Algunas advertencias menores:

- Los componentes admin importan directo `@segurasist/ui` para los
  primitives DS-1 (`LordIcon`, `GsapFade`, `GsapStagger`, `PageTransition`).
  Si por alguna razón DS-1 no publicó la versión final (ver
  `listUnresolvedIcons()`), la build sigue verde — los hooks SSR-safe
  manejan el fallback.
- date-fns está disponible transitivamente via `@segurasist/ui` (mismo
  patrón que branding-editor). Si vitest del portal/admin se queja de
  resolución, declarar explícito en `apps/admin/package.json` y
  `apps/portal/package.json`.

## Para iter 2 / cross-cutting

- **CSV import enriquecimiento**: el resumen muestra inserted/updated/skipped
  pero no permite review pre-commit (revisar parsed rows y aprobar
  sólo un subset). Implementar un dry-run mode: `POST /v1/admin/chatbot/kb/import?dryRun=true`
  → returna las filas parseadas sin escribir, FE muestra checkboxes y
  sólo después confirma con `dryRun=false`.
- **Retención hard-delete vs anonymize**: el cron hace hard-delete a 30d.
  Si compliance pide audit trail post-delete, considerar anonymize
  (clear `content` pero preserve `id`/`tenantId`/`createdAt` para
  estadísticas). NEW-FINDING para PRD compliance.
- **Lordicon catalog**: completar IDs `lab-flask`, `import-export`,
  `lightbulb`, `arrow-right`, etc. en `catalog.ts` (DS-1 owner).
- **Test cross-tenant**: agregar `tests/e2e/admin-kb-cross-tenant.spec.ts`
  (admin_mac de tenant A no ve entries de tenant B). MT-4 owner.
- **Pagination histórica**: actualmente "Cargar más" reemplaza el
  offset. Si el cliente tiene >100 conversaciones (improbable con TTL
  30d pero edge case), considerar useInfiniteQuery con concat.
- **Filtros en histórico portal**: filtrar por status (active/escalated/closed).
  No estaba en el brief pero UX-wise podría agregarlo iter 2.
- **`<LordIcon name="chat-bubble">` en empty state**: confirma que
  el ID `hrjifpbq.json` del catálogo es el correcto para "chat
  bubble" (el catálogo no tiene `<TODO_ID_*>` aquí, así que debería
  funcionar — visual review pendiente).
- **Toggle a `<Switch>` Radix**: el `EnabledToggle` custom funciona
  pero perdería el day-2 a11y de Radix. DS-1 podría publicar
  `<Switch>` en `@segurasist/ui`.
- **Coverage diff**: ejecutar `pnpm --filter admin test:coverage`
  + `pnpm --filter portal test:coverage` y comparar contra Sprint 4
  baseline en `docs/sprint5/COVERAGE_DIFF.md`.
