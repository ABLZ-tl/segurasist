# S5-3 iter 2 — 2026-04-28

## Plan

Cierre de iter 2 sobre los CC delegados (CC-14 CSV streaming, CC-15
Lordicon catalog) + un ADR ligero documentado in-feed sobre la decisión
de retención (anonymize vs hard-delete). No tocar nada fuera del File
Ownership de S5-3 (BE chatbot kb-admin/conversations-history/cron, FE
admin chatbot kb, FE portal chatbot history).

## Hechos iter 2

### CC-15 — Catálogo Lordicon: verificación + fallback

**Estado del catálogo DS-1 antes de iter 2** (lectura de
`packages/ui/src/lord-icon/catalog.ts`):

```
'lab-flask':    `${HOST}/<TODO_ID_LAB_FLASK>.json`     ← UNRESOLVED
'import-export':`${HOST}/<TODO_ID_IMPORT_EXPORT>.json` ← UNRESOLVED
'edit-pencil':  `${HOST}/zfzufhzk.json`                ← OK
'trash-bin':    `${HOST}/skkahier.json`                ← OK
'checkmark-success': `${HOST}/lupuorrc.json`           ← OK
'warning-triangle':  `${HOST}/tdrtiskw.json`           ← OK
'search':       `${HOST}/kkvxgpti.json`                ← OK
'chat-bubble':  `${HOST}/hrjifpbq.json`                ← OK (portal empty state)
```

**DS-1 iter 2 NO ha publicado feed** al momento de cierre S5-3 iter 2
(`docs/sprint5/feed/DS-1-iter2.md` no existe; `listUnresolvedIcons()`
sigue retornando `lab-flask` y `import-export` entre otros). Por tanto
el riesgo es real: `<LordIcon name="lab-flask">` renderiza el placeholder
URL con `<TODO_ID_*>`, el web component falla silenciosamente al cargar
y queda un span sized vacío en el DOM. Empty-state, panel test-match y
botón CSV import son visualmente afectados (cuadro blanco grande en
empty-state — UX inaceptable).

**Decisión**: refactor de `_lordicons.ts` para exponer un componente
adapter `<KbIcon kind="...">` que decide en tiempo de render entre
`<LordIcon>` (cuando el name del catálogo está resuelto) y un Lucide
fallback (cuando el catálogo aún tiene `<TODO_ID_*>`).

**Cambios concretos**:

- `apps/admin/app/(app)/chatbot/kb/_lordicons.ts`
  - Mantengo `KB_ICONS` (string-table de nombres canónicos) para
    backward-compat de cualquier consumidor externo / tests.
  - Agrego `UNRESOLVED_KIND` set con `['testMatch', 'csvImport', 'emptyState']`
    — las claves cuyo Lordicon sigue con `<TODO_ID_*>`.
  - Agrego `LUCIDE_FALLBACK` map (kind → componente Lucide):
    - `testMatch`/`emptyState` → `FlaskConical` (laboratorio)
    - `csvImport` → `Upload`
    - `rowEdit` → `Edit3`, `rowDelete` → `Trash2`, etc. (también
      poblados aunque actualmente caigan al path Lordicon — futuro-proof
      si el catálogo regresa a placeholder por alguna razón).
  - Exporto `KbIcon` (componente adapter) que delega a `LordIcon` o
    Lucide según `UNRESOLVED_KIND.has(kind)`.
  - `.ts` no `.tsx` — uso `React.createElement` para no cambiar la
    extensión y minimizar diff.
- Call sites migrados a `<KbIcon kind="...">`:
  - `kb-list-client.tsx` — 7 instancias (saveSuccess, testMatch,
    csvImport, search, emptyState, rowEdit, rowDelete).
  - `kb-csv-import.tsx` — 1 instancia (csvImport).
  - `kb-test-match.tsx` — 1 instancia (testMatch).
  - `kb-entry-form.tsx` — 2 instancias (saveSuccess en toast).
  - Total 11 sitios. Imports de `LordIcon` directo eliminados de
    los 4 componentes (sólo `_lordicons.ts` lo importa).

**Cuando DS-1 publique los IDs definitivos**:

- Único punto a tocar: vaciar `UNRESOLVED_KIND` en `_lordicons.ts`.
- Cero cambios en call sites.
- Tests no se ven afectados (el spec de kb-list.spec ya no asserta el
  DOM del icono — sólo testids del row/empty-state contenedor; el
  spec de chatbot-history sí asserta `lord-icon-chat-bubble` testid
  pero `chat-bubble` está RESUELTO en el catálogo).

**Por qué Lucide y no esperar a DS-1**: el directive iter 2 dice
*"Si NO los publicó en su iter 2, tu `_lordicons.ts` puede quedar con
fallback a Lucide icons (consistente con resto del proyecto)"*. El
`kb-entry-form.tsx` ya usaba `lucide-react` (X icon del drawer header),
así que no hay nueva dep. El package `lucide-react@0.408.0` ya está
en `apps/admin/package.json`.

### CC-14 — CSV streaming (multipart): defer a Sprint 6

**Evaluación de scope** (objetivo iter 2: <30 LOC → hacerlo, >30 LOC →
defer):

| Capa | Cambio mínimo | LOC estimadas |
|---|---|---|
| BE controller | reemplazar `@Body(Zod) dto` por `@Req()` + parsing multipart con `fastify-multipart` (Multer NO se usa en proyecto, único módulo con file upload es S2-evidencia que parsea via stream raw — patrón a replicar). Cambiar shape DTO de `{csv:string,upsert:boolean}` a request-multipart con part `file` + form field `upsert`. | ~40 |
| BE DTO | `ImportKbCsvSchema` ya valida `csv: z.string()`. Hay que separar: validar `upsert: boolean` por parte del field, y parsear el body string del file part por separado (sin Zod max-size — controlamos size del stream con `limits.fileSize` de fastify-multipart). | ~15 |
| BE service | Sin cambios (recibe `string` del CSV — la diferencia es cómo llega). Actualmente reads file completamente; streaming real (parse line-by-line) sería refactor mayor de `importCsv` que actualmente hace `csv.split('\n').map(parse)`. | ~5 si sólo cambia firma, +60 si stream real |
| FE `kb-csv-import.tsx` | reemplazar `file.text()` + `mut.mutateAsync({csv,upsert})` por `FormData` + `apiMultipart()`. Hook `useImportKbCsv` también cambia signature. | ~20 |
| Hook `admin-chatbot-kb.ts` | swap `api()` por `apiMultipart()` en `useImportKbCsv`. Cambiar tipos `ImportKbCsvDto` (no más `csv: string`). | ~15 |
| Tests BE | `kb-admin.service.spec.ts` no se afecta si firma de service queda `string`. Test de controller (si existe e2e) requiere multipart fixture. | ~10 |
| Tests FE | `kb-list.spec.tsx` test #9 (`acepta archivo .csv y dispara mutation con el contenido`) actualmente asserta `expect(importAsync).toHaveBeenCalledTimes(1)` y matchea `{csv: stringContaining('intent,title'), upsert: true}`. Con multipart, el matcher es `FormData.get('upsert')` etc. — refactor del expectation. | ~10 |

**Total mínimo: ~95 LOC** (sin streaming real, sólo multipart wire).
Excede el budget iter 2 (<30 LOC). Además multipart es una decisión
arquitectural que afecta al patrón de toda la API (hoy sólo S2 evidencia
hace upload binario), y vale coordinarse con MT-2 (que ya publicó
`apiMultipart()` para tenant logo upload — el CSV import sería el
segundo consumidor) para validar convenciones de field-name.

**Decisión**: defer a Sprint 6. Mantener el contrato actual
`POST /v1/admin/chatbot/kb/import` con body `{csv:string, upsert:boolean}`.
El cap de 1MB del Zod (`csv: z.string().max(1024*1024)`) sigue cubriendo
el caso de uso MVP (los CSVs típicos de KB tienen <500 entries × ~200
bytes ≈ 100KB). NEW-FINDING-1 abajo lo recoge.

### Retention anonymize vs hard-delete — ADR ligero in-feed

**Estado actual**:

- `cron/conversations-retention.service.ts:144-153` hace HARD DELETE de
  `chatMessage` + `chatConversation` cuando `expiresAt < NOW()`.
- `expiresAt` se setea a `createdAt + 30 days` por trigger BE en la
  creación de la conversación (Sprint 4 BE — fuera de mi scope).
- Audit log per-conversation queda persistido (resourceId, tenantId,
  insuredId), pero el contenido de los mensajes desaparece sin rastro.

**Riesgo compliance** (LOPDP México, Ley General de Protección de
Datos Personales en Posesión de Sujetos Obligados art. 22 — derecho
al olvido vs retención de auditoría para investigación regulatoria CNSF):

- Hard-delete cumple "right to erasure" inmediato.
- Pero CNSF puede pedir trazabilidad post-hoc para casos de fraude /
  reclamación de aseguradora — `audit_log.payloadDiff.reason='retention_30d'`
  prueba que la conversación existió pero no su contenido.
- ¿Es suficiente? PRD compliance Sprint 4 NO especifica. Sprint 5
  brief tampoco. Sin requirement explícito para anonymize, hard-delete
  es defendible como minimization-default (GDPR art. 5.1.c "data
  minimisation" — equivalente LOPDP art. 17).

**Opción A (recomendada por directive iter 2)**:

1. Migration: agregar columna `chat_messages.anonymizedAt: TIMESTAMPTZ NULL`.
2. Cron en 2 fases:
   - **Fase 1 (T+30d)**: `UPDATE chat_messages SET content='[redactado por retención]', anonymizedAt=NOW() WHERE conversation.expiresAt < NOW()`. Audit emit per-conv `subAction:chatbot_conversation_anonymized`.
   - **Fase 2 (T+120d)** (90 días extra post-anonymize): `DELETE chat_messages, chat_conversations WHERE anonymizedAt < NOW() - INTERVAL '90 days'`. Audit emit per-conv `subAction:chatbot_conversation_purged_post_anonymize`.
3. Test BE: 2 spec adicionales (cubre anonymize + delete-post-anonymize).
4. Doc en runbook (no existe `RB-022-chatbot-retention.md` aún; crearlo).

**Costo iter 2**:

- Prisma migration: 1 línea ALTER TABLE + regenerate types.
- `conversations-retention.service.ts`: refactor `runOnce` para 2-pass
  (anonymize-pass + purge-pass), ~80 LOC nuevas. La interfaz actual
  `runOnce(): {purgedConversations, purgedMessages, durationMs}` cambia
  a `runOnce(): {anonymized, purged, durationMs}`. Test existente rompe
  (asserta `purgedConversations`/`purgedMessages` que ya no existen).
- Tests: 2 specs nuevas + reescribir las 3 existentes para el shape
  nuevo. ~120 LOC total.
- Migration deploy: requiere ventana de maintenance + DBA review (FK
  pattern, no rompe RLS, pero columna nueva en hot table).

**Decisión**: defer a Sprint 6. Razonamiento:

1. **Sin requerimiento explícito de compliance**, hard-delete es la
   default segura (data minimization-first).
2. **Cambio NO trivial** (+200 LOC, migration, test rewrite). Excede el
   budget iter 2.
3. **Riesgo de regression**: la migration toca `chat_messages` (tabla
   hot del bot widget — Sprint 4 endpoint `POST /v1/chatbot/message` la
   escribe en cada turn). Una migration online en Sprint 5 close-day
   sin coordinarse con MT-1 (Prisma owner) es operacionalmente
   peligroso.
4. **Mantengo audit trail**: el `audit_log` actual ya emite
   `subAction:chatbot_conversation_purged` per-conv con tenantId +
   insuredId + resourceId — eso es suficiente para "esta conv existió"
   forensics. Falta el contenido — pero falta INTENCIONALMENTE.

NEW-FINDING-2 abajo documenta el follow-up para Sprint 6 con
compliance-driven priority.

**Nota de runbook**: no creé `RB-022-chatbot-retention.md` esta iter
(scope: NO escribir docs no-solicitadas). Cuando Sprint 6 implemente
anonymize, el runbook nace en ese sprint con la migration paso a paso.
La documentación del comportamiento actual queda inline en el
docstring de `ConversationsRetentionService` (ya completo en iter 1).

### Tests verificación

| Spec | Status | Comentarios |
|---|---|---|
| `apps/admin/test/integration/kb-list.spec.tsx` | OK conceptual | Mocks `lord-icon-element`/`lottie-web`/`gsap`. Mock de `@segurasist/ui` solo override `toast`. Render real de `<LordIcon>` (rowEdit/rowDelete/saveSuccess/search → resolved → web component) + Lucide (testMatch/csvImport/emptyState → fallback). No asserts del DOM del icono — sólo testids del contenedor empty-state/row. Pasa sin cambios. |
| `apps/portal/test/integration/chatbot-history.spec.tsx` | OK conceptual | Mock de `@segurasist/ui` stubea `LordIcon` a `<span data-testid="lord-icon-${name}">`. El history-client renderiza `<LordIcon name="chat-bubble">` (chat-bubble está RESUELTO, fuera del unresolved set) → testid `lord-icon-chat-bubble` aparece → assertion pasa. |
| `segurasist-api/test/unit/modules/chatbot/conversations-retention.service.spec.ts` | OK sin cambios | No toqué el cron. Sigue verde. |
| `segurasist-api/test/unit/modules/chatbot/kb-admin.service.spec.ts` | OK sin cambios | No toqué service. |
| `segurasist-api/test/unit/modules/chatbot/conversations-history.service.spec.ts` | OK sin cambios | No toqué service. |

**Stubs DS-1**: el iter 1 mencionaba `_stubs.tsx`/`ds1-stubs.tsx` (CC-21
para MT-2/MT-3) — no hay stubs locales en S5-3. Los componentes ya
importan directo de `@segurasist/ui` desde iter 1. Verificación
completa.

## NEW-FINDING (iter 2)

1. **CSV import multipart streaming — Sprint 6**.
   - Owner sugerido: S5-3 (continuidad) o un agente CC dedicado.
   - Coordinar con MT-2 (publisher de `apiMultipart()`) sobre convención
     de field-name (probablemente `file` + `upsert` form-field).
   - Patrón fastify-multipart a replicar: `segurasist-api/src/modules/incidents/evidence/` (S2 evidence upload — único otro consumidor binario).
   - Decisión side: ¿streaming line-by-line (memory-bounded) vs read-all
     entonces split? Si KB import esperable <10MB, read-all es OK; >10MB,
     streaming es obligatorio. UX-wise un CSV >10MB en KB es señal de
     mal data hygiene (el editor admin debería paginarlos por tema).

2. **Retention anonymize a 30d + hard-delete a 120d — Sprint 6 (compliance-driven)**.
   - Owner sugerido: depende de PRD compliance review. Si CNSF responds
     "necesitamos trazabilidad de contenido por 90d post-conv", entonces
     S5-3 owner (este agente) ejecuta. Si responde "minimization OK con
     audit metadata", se cierra el finding sin acción.
   - Componentes:
     - Prisma migration `add_anonymized_at_to_chat_messages`.
     - `ConversationsRetentionService.runOnce` 2-pass refactor.
     - Tests: rewrite + 2 nuevos specs.
     - `RB-022-chatbot-retention.md` (nuevo runbook).
     - ADR si la decisión es controversial — ADR-0012 candidate.
   - Estimación: 5h dev + 2h DBA review + 1h compliance signoff.

3. **Catálogo Lordicon `lab-flask`/`import-export` — DS-1 owner persistente**.
   - Si DS-1 no resuelve en Sprint 5 final, el patrón `<KbIcon>` con
     fallback Lucide ya es prod-safe — no bloquea release. Iter 2 cierre
     S5-3 NO depende de DS-1.
   - Cuando DS-1 publique, eliminar `'testMatch'`, `'csvImport'`,
     `'emptyState'` de `UNRESOLVED_KIND` en `_lordicons.ts`. PR de 3
     líneas.

4. **`<KbIcon>` candidato a `@segurasist/ui`**.
   - El patrón "logical name → Lordicon | Lucide fallback" puede
     beneficiar a otros features (e.g. branding-editor de MT-2 que
     también consume `cloud-upload`/`palette` del catálogo). DS-1
     podría adoptar un patrón genérico `<UIIcon>` que reemplaza el
     fallback span del actual `<LordIcon>` por un Lucide map curado.
     Defer a iter futura — no bloquea.

5. **`KB_ICONS` const sigue exportada por backward-compat**.
   - Algún test futuro o tool externo podría leer la string-table sin
     usar `<KbIcon>`. Si nadie la consume en 1-2 sprints, eliminarla
     y romper la exportación.

## Bloqueos

Ninguno. Iter 2 cierra los CC-14/CC-15 con decisión documentada (defer
para CC-14 + ADR ligero para retention; resolved para CC-15 con fallback).

## Para iter 3 / Sprint 6

- CC-14 multipart streaming (NEW-FINDING-1).
- Anonymize retention (NEW-FINDING-2) — esperar input compliance.
- Pruning del `KB_ICONS` const si nadie lo consume directamente.
- DS-1 sync: cuando publiquen IDs, eliminar entries del
  `UNRESOLVED_KIND` set.
