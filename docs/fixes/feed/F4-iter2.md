## F4 iter 2 — dedupeId cleanup + ENV consumption (workers)

[F4] 2026-04-27 22:10 iter2 STARTED — dedupeId cleanup + ENV consumption

[F4] 2026-04-27 22:12 iter2 BLOCKED workers ENV — depende F3 (visto entry [F3] DONE en feed: NO). `_fixes-feed.md` solo registra `[F3] iter1 NEW-FINDING` (línea 149) prometiendo agregar `SQS_QUEUE_INSUREDS_CREATION` a `.env.example` cuando F5 lo declare; no hay entry `[F3] iter2 DONE env.schema.ts:78 — SQS_QUEUE_INSUREDS_CREATION agregado`. Verificación directa de `segurasist-api/src/config/env.schema.ts:74-77` confirma que sólo existen `SQS_QUEUE_LAYOUT/PDF/EMAIL/REPORTS`. Mantengo el bloque `String.replace` fail-fast intacto en `insureds-creation-worker.service.ts:65-86` y `batches.service.ts:497-513`. NEEDS-COORDINATION F3 (re-pedido). Re-emitir Follow-up 1 en próxima iter cuando F3 publique la env.

[F4] 2026-04-27 22:20 iter2 DONE 5 dedupeId callers limpiados — eliminado el 3er argumento `dedupeId` (string template) en los 5 sitios reportados por F5 iter 1 (feed entries 199-205):
  1. `segurasist-api/src/modules/batches/batches.service.ts:434-444` (confirm → insureds-creation, era `${id}:${r.rowNumber}`) — comentario in-line apunta idempotencia DB-side a `(tenant_id, curp)` UNIQUE + `batch_processed_rows` PK compuesto (F5 migration).
  2. `segurasist-api/src/modules/batches/batches.service.ts:643-647` (publishPreviewReady, era `${batchId}:preview_ready`) — comentario nota cola standard ignora MessageDeduplicationId.
  3. `segurasist-api/src/workers/insureds-creation-worker.service.ts:164-167` (insured.created → SQS_QUEUE_PDF, era `${createdInsuredId}:created`) — comentario delega idempotencia al UNIQUE `(tenant_id, insured_id, version)` en `certificates` (F1 owner).
  4. `segurasist-api/src/workers/insureds-creation-worker.service.ts:328-332` (batch.completed → SQS_QUEUE_LAYOUT, era `${batchId}:completed`) — comentario nota exactly-once ya garantizado por CAS sobre `completed_event_emitted_at`.
  5. `segurasist-api/src/workers/layout-worker.service.ts:182-185` (batch.preview_ready, era `${batchId}:preview_ready`) — comentario nota re-procesamiento idempotente por `batchError.deleteMany` al inicio de processBatch.
  Cada call queda `sqs.sendMessage(queueUrl, body)` 2-arg, alineado con la firma post-C-09 de F5 (`src/infra/aws/sqs.service.ts:34-37`). Sin breakage TS — la signature ya rechazaba un 3er arg sin `as unknown` cast, así que estos eran callers que pasaban TS check sólo porque la firma anterior lo aceptaba opcional, pero F5 ya la había acotado a 2 — confirmar con build en gate.

[F4] 2026-04-27 22:25 iter2 NOTE tests-not-run — `pnpm test -- batches insureds-creation-worker layout-worker` bloqueado por sandbox permisos en este entorno (mismo bloqueo que iter 1). Inspección manual: `test/integration/batches-flow.spec.ts:454, 483` accede a `sqs.sendMessage.mock.calls[0]![1]` (índice body) — no se asserta sobre el ex-3er argumento, así que el cleanup NO rompe expectativas existentes. Validation gate del orquestador debe correr la suite scoped post-merge.

[F4] 2026-04-27 22:25 iter2 NOTE no-toco-sqs.service.ts — F5 owner; firma sigue siendo `sendMessage(queueUrl, body)` (2 args).

[F4] 2026-04-27 22:25 iter2 NOTE no-toco-env.schema.ts — F3 owner. Yo sólo consumo `process.env.SQS_QUEUE_INSUREDS_CREATION` cuando aterrice (Follow-up 1, deferred a iter 3 / cuando F3 publique).

[F4] 2026-04-27 22:25 iter2 iter2-complete — Follow-up 2 cerrado (5 callers zombie limpiados). Follow-up 1 BLOCKED por F3. Follow-up 3 (run tests) BLOCKED por sandbox; documentado.
