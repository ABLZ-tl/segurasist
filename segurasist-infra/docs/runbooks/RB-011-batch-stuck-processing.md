# RB-011 — Batch stuck en `processing` / `validating`

- **Severity**: P2 (operación cliente bloqueada — no puede mover el batch
  a `completed`; no afecta resto del tenant ni cross-tenant)
- **On-call SLA**: acknowledge ≤ 30 min (business hours), resolve ≤ 8 h
- **Owner**: DevOps on-call + Backend Lead (módulo `batches` /
  `insureds-creation-worker`)
- **Triggered by** (any of):
  - CloudWatch alarm `segurasist-{env}-sqs-layout-dlq-depth > 0`
  - CloudWatch alarm `segurasist-{env}-sqs-insureds-creation-dlq-depth > 0`
  - Ticket de soporte: "subí el XLSX hace > 1 h y sigue diciendo
    Validando" o "sigue procesando, no termina nunca".
  - Query manual de tenant admin:
    `SELECT id, status, updated_at FROM batches
    WHERE status IN ('validating','processing') AND updated_at < NOW()-INTERVAL '15 min'`
- **Related**: RB-004 (SQS DLQ general), RB-012 (PDF generation backlog,
  state-machine downstream), C-09 (SQS dedupeId removal — workers ahora
  son idempotentes por `batch_id` en BD), H-29 (insureds-creation worker
  retries).

> **Numeración**: este slug `RB-011-batch-stuck-processing` fue reclamado
> por el audit Sprint 5; previamente el slot `RB-011` estaba ocupado por
> el runbook DAST, ahora reubicado en `RB-015-dast-failure.md` (F8 iter 2).

## What this means

Un `Batch` debe transicionar:

```
validating → preview_ready → processing → completed
              ↘ failed (validación)        ↘ failed (procesamiento)
```

- **`validating` > 15 min**: el `layout-worker` consumió el mensaje
  y nunca volvió a actualizar `batches.status`. Causa típica: el worker
  crasheó mid-job o el mensaje quedó "in-flight" y SQS lo redrive a la
  DLQ tras `maxReceiveCount=3`.
- **`processing` > 30 min** (sobre todo en batches con > 1k filas):
  el `insureds-creation-worker` está atorado por backpressure
  (RDS pool exhausto, Cognito throttle al crear users). Si la cola
  `insureds-creation-dlq` tiene mensajes → batch concretamente fallado
  pero el row de `batches` no fue actualizado a `failed` (bug — el
  worker debe escribir DB antes de ack).

## Triage (≤ 5 min)

1. Identificar batch(es) afectado(s):
   ```sql
   SELECT b.id, b.tenant_id, b.status, b.total_rows, b.processed_rows,
          b.created_at, b.updated_at, NOW() - b.updated_at AS stale_for
   FROM batches b
   WHERE b.status IN ('validating','processing')
     AND b.updated_at < NOW() - INTERVAL '15 minutes'
   ORDER BY b.updated_at ASC;
   ```
2. Para cada batch, decidir flow:
   - `status='validating'` y `processed_rows IS NULL` → flujo A
     (layout-worker / preview generation).
   - `status='processing'` y `processed_rows < total_rows` → flujo B
     (insureds-creation worker en curso o atascado).
   - `status='processing'` y `processed_rows == total_rows` → bug:
     el worker terminó pero NO movió a `completed`. Flujo C.
3. Inspeccionar DLQ correspondiente (peek SIN delete):
   ```bash
   aws sqs receive-message \
     --queue-url $(terraform -chdir=envs/{env} output -raw sqs_layout_dlq_url) \
     --max-number-of-messages 1 \
     --visibility-timeout 0 \
     --message-attribute-names All
   ```
   Anotar `MessageId`, `ApproximateReceiveCount`, body (contiene
   `batchId` + `tenantId`). Confirmar 1-a-1 con la fila de `batches`.

## Mitigation — Flujo A (`validating` stuck)

1. Ver logs del `layout-worker` últimos 30 min:
   ```bash
   aws logs filter-log-events \
     --log-group-name /aws/apprunner/segurasist-{env}-api/<service-id>/application \
     --start-time $(($(date +%s) - 1800))000 \
     --filter-pattern '"[layout-worker]" "<batch-id>"'
   ```
2. Causas comunes:
   - **XLSX corrupto** (header inválido, encoding raro): el parser
     lanza excepción no manejada → SQS retry hasta DLQ. Solución:
     marcar batch `failed` con motivo y notificar al tenant.
     ```sql
     UPDATE batches
        SET status='failed',
            failure_reason='Layout inválido (ver soporte)',
            updated_at=NOW()
      WHERE id='<batch-id>';
     ```
   - **S3 GetObject 403** (uploads bucket): IAM drift; verificar el
     instance role de App Runner tenga `s3:GetObject` sobre
     `${name_prefix}-uploads-*`.
   - **Worker timeout** (visibility timeout 60 s en `layout` queue
     insuficiente para XLSX > 5k filas): bumpear `vt` en
     `envs/{env}/main.tf:locals.queues.layout` a 180 y `terraform
     apply`. Documentar en postmortem.
3. Si la causa es transitoria y el batch aún es recuperable, redrive
   manual desde DLQ:
   ```bash
   aws sqs start-message-move-task \
     --source-arn $(terraform -chdir=envs/{env} output -raw sqs_layout_dlq_arn) \
     --max-number-of-messages-per-second 5
   ```
   El worker reprocesa con `processed_rows=0` (idempotente por
   `batch_id`).

## Mitigation — Flujo B (`processing` con progreso parcial)

1. Verificar **RDS pool exhausto**:
   ```sql
   SELECT count(*) AS active, max_conn
     FROM (SELECT count(*) AS active FROM pg_stat_activity
            WHERE state='active') a,
          (SELECT setting::int AS max_conn FROM pg_settings
            WHERE name='max_connections') m;
   ```
   Si `active > 0.8 * max_conn` → ver RB-002 (RDS connections).
2. **Cognito throttle** en `AdminCreateUser` (insureds creation
   crea identidades en pool insured):
   ```bash
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Cognito \
     --metric-name ThrottleCount \
     --dimensions Name=UserPool,Value=<insured-pool-id> \
     --start-time $(date -u -v-30M +%FT%TZ) \
     --end-time $(date -u +%FT%TZ) \
     --period 60 --statistics Sum
   ```
   Si > 0 → throttle activo (alarma `cognito-insured-throttle` debió
   disparar). Esperar ventana o solicitar service quota bump.
3. Si la cola viva (`insureds-creation`) tiene depth > 0 pero el
   worker está OK → es backpressure normal; verificar progreso con
   `processed_rows` cada 60 s y dejar correr.
4. Si el worker NO progresa (depth idéntico 5 min) y NO hay DLQ →
   App Runner instance del worker freezed: `aws apprunner
   start-deployment --service-arn <api-arn>` para reiniciar (rolling).

## Mitigation — Flujo C (worker terminó, batch no movido a `completed`)

Bug puro: el worker hizo `processed_rows = total_rows` pero un crash
después de ack y antes del UPDATE final dejó el row en `processing`.

1. Confirmar que NO quedan mensajes in-flight para ese `batch_id`:
   ```bash
   aws sqs get-queue-attributes \
     --queue-url $(terraform output -raw sqs_insureds_creation_url) \
     --attribute-names ApproximateNumberOfMessagesNotVisible
   ```
   Debe ser `0` antes de cerrar el batch.
2. Cerrar manual:
   ```sql
   UPDATE batches
      SET status='completed', updated_at=NOW()
    WHERE id='<batch-id>'
      AND status='processing'
      AND total_rows = processed_rows;
   ```
3. Notificar al tenant que el batch está disponible.

## Root cause investigation (post-mitigación)

- ¿El crash fue por OOM en App Runner instance? Revisar `MemoryUtilization`
  en `AWS/AppRunner` durante la ventana.
- ¿Falta idempotencia? El worker debe poder reconsumir el mismo
  `batch_id` sin doble inserción (tras C-09 los workers ya no usan
  dedupeId SQS — la idempotencia es a nivel BD via `(batch_id, row_idx)`
  unique constraint).
- ¿Se podría haber atrapado más temprano? Considerar alarma:
  `batches WHERE status IN ('validating','processing') AND updated_at <
  NOW() - INTERVAL '20 min' COUNT > 0` emitida como custom metric vía
  EMF cada 5 min (Sprint 5 backlog).

## Postmortem checklist

- [ ] Tenant + batch_id afectado(s).
- [ ] Categoría: layout corrupto / RDS exhausto / Cognito throttle /
      timeout / OOM / bug idempotencia / orden de operaciones (ack
      antes de UPDATE final).
- [ ] # filas totales, # filas procesadas, # filas perdidas (si las hay).
- [ ] Detection gap: ¿alarma DLQ disparó a tiempo? ¿el tenant tuvo
      que abrir ticket?
- [ ] Action items (≤ 2 semanas):
  - [ ] Si fue Flujo C (worker no actualiza DB): mover el `UPDATE
        status='completed'` ANTES del ack SQS (transactional outbox
        pattern).
  - [ ] Si fue timeout layout: bumpear `vt` permanente.
  - [ ] Si fue Cognito throttle recurrente: solicitar quota bump
        a AWS Support.
- [ ] Update este RB-011 con la nueva clase de causa si emerge un
      patrón sistémico (≥ 3 incidentes mismo origen / trimestre).

## Métricas de tracking

- `batches stuck > 15 min` por mes (objetivo: ≤ 1 / env / mes).
- Tiempo medio entre detección y unstuck (objetivo: < 1 h).
- Ratio Flujo A / B / C (si C > 30% → priorizar el fix de orden de
  operaciones worker).

## Referencias

- `segurasist-api/src/workers/insureds-creation-worker.service.ts`
- `segurasist-api/src/workers/layout-worker.service.ts`
- `segurasist-api/prisma/schema.prisma` — `enum BatchStatus`
- `segurasist-infra/envs/{env}/main.tf:locals.queues` — `vt` por queue.
- RB-004 (SQS DLQ general), RB-012 (PDF backlog).
