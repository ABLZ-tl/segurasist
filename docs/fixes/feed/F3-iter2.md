# F3 — feed entries iter 2

> Bundle: B-AUTH-SEC + B-RLS + B-EMAIL-TAGS. Append-only. F0 orquestador
> integra estas entradas a `docs/fixes/_fixes-feed.md`. Iter 2 cierra
> coordinación pendiente con F4 + F5 (SQS env) + drift recheck post-F4/F6.

```
[F3] iter2 STARTED — SQS env consolidation + drift recheck
[F3] 2026-04-27 iter2 DONE segurasist-api/src/config/env.schema.ts:78 — agregada `SQS_QUEUE_INSUREDS_CREATION: z.string().url()` después de `SQS_QUEUE_REPORTS`. Comentario in-line apunta a localstack-bootstrap + Terraform de los 3 envs y a la idempotencia DB-side (UNIQUE batch_processed_rows + CAS sobre Batch.completedEventEmittedAt). Cierra NEEDS-COORDINATION F4 (feed/F4-iter1.md:13) + F5 (feed/F5-iter1.md NEEDS-COORDINATION F3). F4 puede eliminar `String.replace('layout-validation-queue', 'insureds-creation-queue')` fail-fast en su iter 2.
[F3] 2026-04-27 iter2 DONE segurasist-api/.env.example — agregada línea `SQS_QUEUE_INSUREDS_CREATION=http://localhost:4566/000000000000/insureds-creation` debajo de SQS_QUEUE_REPORTS, alineada con el nombre que F5 creó en localstack-bootstrap.sh + envs/{dev,staging,prod}/main.tf.
[F3] 2026-04-27 iter2 DONE segurasist-api/src/config/env.schema.spec.ts:24 — VALID_ENV extendido con `SQS_QUEUE_INSUREDS_CREATION: 'http://q5'` para que los specs existentes sigan verdes. Sin nuevos tests scoped (la nueva env ya está cubierta por el test 'parsea un env válido').
[F3] 2026-04-27 iter2 DONE drift recheck schema.prisma ↔ policies.sql post-F4/F6 — F4 agregó columnas a model `Batch` (processed_rows, success_rows, failed_rows, queued_count, completed_event_emitted_at) y F6 extendió enum `AuditAction` (otp_requested, otp_verified, read_viewed, read_downloaded, export_downloaded). NO crearon nuevas tablas con tenant_id; sólo amplían existentes que ya están en policies.sql. Re-corrida del parser estático (test/integration/apply-rls-idempotency.spec.ts): 16 tablas con tenantId en schema (users, packages, coverages, insureds, beneficiaries, certificates, claims, coverage_usage, batches, batch_errors, email_events, chat_messages, chat_kb, system_alerts, audit_log, exports) ↔ 16 tablas en policies.sql `tables TEXT[]`. Sin drift.
[F3] iter2 iter2-complete — SQS env coordinada con F4+F5; drift recheck post-F4/F6 sin findings.
```

## Notas para F10 (DEVELOPER_GUIDE.md)

### §1.6 — RLS drift tripwire

- Ya documentado en F3-iter1: cualquier nueva tabla con `tenant_id` en `prisma/schema.prisma` debe agregarse al array `tables TEXT[]` de `prisma/rls/policies.sql` en el MISMO PR.
- Iter 2 confirma el patrón: cambios que **amplían** una tabla existente (nuevas columnas, nuevos enum values referenciados desde una columna existente) NO requieren update de `policies.sql` — la política ya cubre la fila completa.
- El test `test/integration/apply-rls-idempotency.spec.ts` (sección "drift check") corre sin DB y es la red de seguridad: si un PR agrega `model X { tenantId @map("tenant_id") @@map("x") }` y olvida `policies.sql`, el test falla con `[apply-rls drift] Tablas con tenant_id en schema pero NO en policies.sql: ['x']`.

### §2.2 — SQS worker pattern (post-coordination F3+F4+F5)

- Cada cola SQS de la app DEBE tener una env var dedicada (`SQS_QUEUE_<NAME>: z.string().url()`) en `env.schema.ts`. Anti-pattern: derivar la URL via `String.replace(...)` sobre otra cola — F4 lo dejó fail-fast como mitigación temporal y se eliminó en iter 2 cuando F3 publicó la env definitiva.
- Bootstrap completo de una nueva cola requiere coordinación 3-way:
  1. **F3 (config)**: declarar la env en `env.schema.ts` + `.env.example`.
  2. **F5 (infra)**: crear la cola en `scripts/localstack-bootstrap.sh` (dev) y `segurasist-infra/envs/{dev,staging,prod}/main.tf` (módulo `sqs-queue` con DLQ + redrive policy `maxReceiveCount=3`).
  3. **F4 (workers)**: consumir `process.env.SQS_QUEUE_<NAME>` directo (NO `replace`).
- Idempotencia: colas standard NO soportan `MessageDeduplicationId` (AWS lo descarta silently — A3v2-02). Source-of-truth idempotencia es DB-side: UNIQUE constraint con la "natural key" del recurso + `INSERT ... ON CONFLICT DO NOTHING`. Ejemplo concreto: `batch_processed_rows (tenant_id, batch_id, row_number)` (F5 migration `20260428_insureds_creation_unique`).
