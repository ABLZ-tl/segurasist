# Fix Report — F4 B-BATCHES

## Iter 1 (resumen)

### Issues cerrados

| ID | File:line | Naturaleza del fix |
|---|---|---|
| **C-05** | `src/workers/layout-worker.service.ts:127-145` + `src/modules/batches/validator/batches-validator.service.ts:323-336` | Pre-cómputo de `findIntraFileDuplicates(rows)` ANTES del loop de chunks; nuevo parámetro opcional `precomputed` en `validateAll(rows, ctx, precomputed?)`. Antes: cada chunk de 500 ejecutaba la dedup sobre su slice → CURPs duplicadas separadas por >500 filas no se marcaban. |
| **C-06** | `prisma/schema.prisma` model Batch + `prisma/migrations/20260428_batch_progress_columns/migration.sql` + `src/modules/batches/batches.service.ts:447-470` + `src/workers/insureds-creation-worker.service.ts:249-329` | Columnas dedicadas para fase processing (`processed_rows`, `success_rows`, `failed_rows`) separadas de fase validation (`rows_ok`, `rows_error`). El worker ya NO pisa los counts de validación. |
| **C-07** | `src/workers/insureds-creation-worker.service.ts:249-329` + migration UNIQUE PARTIAL INDEX | Refactor de `bumpBatchCounters` a `UPDATE…RETURNING` atómico + compare-and-set sobre `completed_event_emitted_at IS NULL` para emitir `batch.completed` exactly-once incluso con N workers concurrentes. Backup storage: UNIQUE INDEX parcial. |
| **C-08** | `src/modules/batches/batches.service.ts:447-470` (set `queuedCount`) + `src/workers/insureds-creation-worker.service.ts:285` (compara contra `queued_count`) | El target del confirm se persiste explícitamente; el worker compara contra `queued_count`, NO contra `rowsTotal`. Confirm con `rowsToInclude=[1,2,3]` de 100 filas válidas ahora completa correctamente cuando los 3 mensajes son procesados. |

### Files modificados

- `segurasist-api/src/modules/batches/batches.service.ts` — `confirm()` setea queuedCount + reset counters; `queueUrlForCreations()` fail-fast.
- `segurasist-api/src/workers/layout-worker.service.ts` — pre-compute dups antes del loop.
- `segurasist-api/src/workers/insureds-creation-worker.service.ts` — `bumpBatchCounters` reescrito con CAS atómico; constructor `queueUrl` fail-fast (H-29 partial).
- `segurasist-api/src/modules/batches/validator/batches-validator.service.ts` — `validateAll` acepta `precomputed?` opcional.
- `segurasist-api/prisma/schema.prisma` — model `Batch`: 5 fields nuevos (preservé enum `AuditAction` y resto del schema; F6 lo modificó cross-iter sin conflicto).
- `segurasist-api/prisma/migrations/20260428_batch_progress_columns/migration.sql` — NUEVO. ALTER TABLE + UNIQUE PARTIAL INDEX.

### Tests añadidos

- `test/integration/batches-flow.spec.ts` (extendido):
  - **C-05 cross-chunk dups** (1 test): 1010 filas xlsx con CURP duplicada en filas 5/600/900 (3 chunks distintos) → ambas ocurrencias post-primera marcadas `DUPLICATED_IN_FILE`.
  - **C-08 rowsToInclude subset** (1 test): batch sync 100 filas válidas, `confirm({rowsToInclude:[1,2,3]})` → `queuedCount=3` persistido, processedRows/successRows/failedRows reset a 0, exactamente 3 mensajes encolados.
- `test/integration/batch-completed-once.spec.ts` (NUEVO):
  - **C-07 concurrencia** (1 test): `Promise.all([worker.processMessage(msg1), worker.processMessage(msg2)])` con queued_count=2 → exactamente 1 evento `batch.completed`.
  - **C-07 CAS pierde** (1 test): bump devuelve listo, CAS responde 0 filas → no se emite `batch.completed`.
- `test/unit/modules/batches/insureds-creation-worker.spec.ts` (adaptado a nueva API): 3 tests originales actualizados ($queryRaw en lugar de $executeRaw + findFirst) + 2 tests nuevos (CAS pierde, processed<queued mid-progress).

### Tests existentes corridos

- ❗ NO ejecutados localmente. La sandbox del entorno bloqueó `pnpm test` / `pnpm jest` por permisos. Documentado en `_fixes-feed.md` para que F0 los corra en iter 2.

### Cross-cutting findings (en feed)

- **NEW-FINDING insured.created en cola standard**: dedupeId ignorado (A3v2-02 confirma). Pertenece a F5 + F1 coordination — out-of-scope iter 1.
- **NEW-FINDING test/security/cross-tenant.spec.ts:249-252**: 3 it.todo para batches HTTP. F9 owner.
- **NEEDS-COORDINATION F5**: agregar `SQS_QUEUE_INSUREDS_CREATION` al `env.schema.ts` + `.env.example`. Hasta entonces, mantengo `String.replace` con guard fail-fast.

## Iter 2 (resumen)

### Trabajo iter 2

| Follow-up | Estado | Notas |
|---|---|---|
| **FU-1** workers ENV (consumo de `SQS_QUEUE_INSUREDS_CREATION`) | **BLOCKED** | F3 todavía no publica la env. `env.schema.ts:74-77` sigue con sólo LAYOUT/PDF/EMAIL/REPORTS. El bloque `String.replace` fail-fast queda intacto en `insureds-creation-worker.service.ts:65-86` + `batches.service.ts:497-513`. Re-emitido NEEDS-COORDINATION F3. Cierra cuando F3 agregue la entry. |
| **FU-2** dedupeId callers zombie | **DONE** | 5 sitios limpiados (ver tabla abajo). |
| **FU-3** run tests scoped | **BLOCKED-tests-not-run** | `pnpm test` bloqueado por sandbox (mismo bloqueo que iter 1). Inspección manual confirma que las assertions sobre `sqs.sendMessage.mock.calls` sólo leen `[0]` (queueUrl) y `[1]` (body), no `[2]`. |

### Files modificados iter 2

| File:line | Antes | Después |
|---|---|---|
| `src/modules/batches/batches.service.ts:434-444` | `sqs.sendMessage(url, body, '${id}:${r.rowNumber}')` | `sqs.sendMessage(url, body)` + comentario que delega idempotencia a UNIQUE `(tenant_id, curp)` + `batch_processed_rows` |
| `src/modules/batches/batches.service.ts:644-648` | `sqs.sendMessage(url, event, '${batchId}:preview_ready')` | 2-arg + comentario sobre cola standard |
| `src/workers/insureds-creation-worker.service.ts:164-167` | `sqs.sendMessage(SQS_QUEUE_PDF, event, '${createdInsuredId}:created')` | 2-arg + comentario delegando idempotencia al UNIQUE de `certificates` (F1 owner) |
| `src/workers/insureds-creation-worker.service.ts:328-332` | `sqs.sendMessage(LAYOUT, event, '${batchId}:completed')` | 2-arg + comentario sobre CAS exactly-once ya garantizando |
| `src/workers/layout-worker.service.ts:182-185` | `sqs.sendMessage(LAYOUT, event, '${batchId}:preview_ready')` | 2-arg + comentario sobre `batchError.deleteMany` idempotency |

### Tests añadidos iter 2

Ninguno — el cleanup elimina un argumento sin agregar features. La regression gate ya existe en `test/integration/sqs-dedup-removal.spec.ts` (F5) que verifica que el SDK NUNCA recibe `MessageDeduplicationId/MessageGroupId` aunque el caller force con `as unknown` cast.

### Cross-cutting findings iter 2

- **NEEDS-COORDINATION F3** (re-emitido): publicar `SQS_QUEUE_INSUREDS_CREATION: z.string().url()` en `src/config/env.schema.ts:78` (después de `SQS_QUEUE_REPORTS`) + `.env.example`. Sin esto, F4 no puede cerrar H-29 al 100%.
- **NO-TOCO**: `src/infra/aws/sqs.service.ts` (F5 owner) y `src/config/env.schema.ts` (F3 owner) — mantenidos read-only en este iter.

### Compliance impact iter 2

- **Limpieza de código zombie**: el 3er argumento `dedupeId` en los 5 callers ya estaba siendo silenciosamente ignorado por `SqsService.sendMessage` post-C-09, pero su presencia léxica generaba (a) confusión para futuros maintainers que asumirían que la idempotencia estaba a nivel SQS, y (b) riesgo de TS error si un build futuro endurecía noUnusedParameters. Cleanup elimina la deuda y deja comentarios in-line que documentan dónde vive realmente la idempotencia (DB-side UNIQUE, CAS, deleteMany+recreate).
- **H-29** sigue partial — pieza ENV/IaC entregada por F5 iter 1 + F3 schema pendiente. Cuando F3 cierre, F4 cierra al 100% en iter 3 con un commit trivial (1 línea por archivo).

## Compliance impact

- **C-05** cierra el gap de validación intra-archivo en archivos >500 filas. La promesa "todas las CURPs duplicadas se detectan antes de confirm" vuelve a ser invariante real.
- **C-06 + C-08** restauran la integridad del state machine post-confirm: `processed_rows >= queued_count` es el invariante que dispara `completed`. Nadie pisa los counters de validación; nadie compara contra el número equivocado.
- **C-07** garantiza exactly-once para `batch.completed` SIN depender de FIFO/dedupe SQS — la idempotencia es DB-side (CAS sobre columna timestamp + UNIQUE PARTIAL INDEX). Esta decisión arquitectónica se alinea con la recomendación A3v2 audit (DB-idempotency > FIFO).
- **H-29 partial**: el bug fail-silent del `String.replace` queda fail-fast. F5 cierra el gap definitivo en iter 2.

## Lecciones para DEVELOPER_GUIDE.md

1. **State machine de batches post-confirm**: `processed_rows / success_rows / failed_rows / queued_count` SON los counters del worker. `rows_ok / rows_error` SON los counters de validación. Dos universos separados; el worker NUNCA pisa los counts de validación.
2. **Exactly-once en colas SQS standard**: la idempotencia se hace DB-side via UNIQUE PARTIAL INDEX + CAS atómico (`UPDATE … WHERE col IS NULL`). NO depender de `MessageDeduplicationId` — AWS lo ignora silenciosamente en colas standard.
3. **Pre-cómputo antes de loops chunked**: cuando un loop chunked necesita información global del set (dedup, totals, etc.), pre-computarla ANTES del loop y pasarla al callee como parámetro opcional. Patrón aplicable a más sitios del repo (`reports-worker`, `insureds.service.search`).
4. **`UPDATE … RETURNING` > `UPDATE` + `findFirst`**: evita TOCTOU sin bloqueos explícitos. Si necesitás la fila post-update, `RETURNING *` la devuelve atómicamente; un `findFirst` separado abre la ventana race.
5. **Migrations cross-agente**: dos agentes (F4 + F6) editaron `schema.prisma` simultáneamente. Estrategia: `Edit` tool (no `Write`), cada uno toca solo su sección, lock por `model X` o `enum Y`. Integración pacífica si las secciones no se solapan.
