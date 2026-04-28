# RB-017 — SQS topic rename drain (Sprint 5 apply)

> _Renumerado de RB-014 → RB-017 en validation gate Sprint 4 closure — colisión con RB-014-monthly-reports-replay.md (S3+S10 iter 2)._


- **Severity**: P2 (planned change — escalates to P1 if drain falla en prod)
- **On-call SLA**: ejecutar en ventana de mantenimiento programada
- **Owner**: DevOps Senior (F8) + Backend SQS owner (F5)
- **Triggered by**: Sprint 5 `terraform apply` que ejecuta el rename
  `segurasist-{env}-certificates` → `segurasist-{env}-pdf` (en envs
  staging y prod). El rename causa **destroy + create** del recurso
  `aws_sqs_queue` (Terraform no soporta rename in-place de SQS).
- **Related**: RB-004 (SQS DLQ), C-09 (dedupeId removal Sprint 4),
  H-29 (queue naming alineada con env)

## Symptom

- Plan de Terraform muestra:
  ```
  # module.sqs["pdf"].aws_sqs_queue.this will be created
  # module.sqs["pdf"].aws_sqs_queue.dlq will be created
  # aws_sqs_queue.legacy_certificates will be destroyed
  # aws_sqs_queue.legacy_certificates_dlq will be destroyed
  ```
- Si se aplica sin drenar: cualquier mensaje en flight (visibility
  timeout open) o pending en `<env>-certificates` se **pierde** al
  destroy. Workers PDF (Lambda + App Runner) reciben `QueueDoesNotExist`
  hasta que el create propague, y el publisher (`pdf-worker.service.ts`,
  `insureds-creation-worker.service.ts`) tira `InvalidParameterValue`.
- DLQ legacy (`<env>-certificates-dlq`) también se destruye → pierdes
  evidencia forense de mensajes que ya fallaron pre-rename.

## Detection

| Source | Metric |
|---|---|
| Terraform plan diff | `aws_sqs_queue` con `# will be destroyed` y `# will be created` para `certificates` y `pdf` |
| AWS Console SQS | `<env>-certificates` `ApproximateNumberOfMessagesVisible > 0` o `ApproximateNumberOfMessagesNotVisible > 0` (in-flight) |
| Pino logs (workers) | `pdf-worker` polling `<env>-certificates` (queueUrl en `env.SQS_QUEUE_PDF` viejo) |
| Audit log | publisher `certificate.issued` con `messageId` registrado pero sin downstream consumer trace |

## Pre-apply checklist

**OBLIGATORIO** antes de `terraform apply` en staging y prod (dev/LocalStack
no aplica — se rebuilda cada `pnpm dev`).

1. **Confirmar plan limpio**:
   ```bash
   cd segurasist-infra/envs/{staging|prod}
   terraform plan -out=tfplan-rename.bin
   terraform show -json tfplan-rename.bin | jq '.resource_changes[] | select(.change.actions[] | contains("delete") or contains("create")) | .address'
   ```
   Esperado: solo `module.sqs["pdf"]` (create) y `aws_sqs_queue.legacy_certificates*` (destroy). Cualquier otro destroy → ABORT.

2. **Pause publishers** — App Runner + workers que publican a
   `<env>-certificates` deben dejar de emitir nuevos mensajes:
   - Set `WORKERS_ENABLED=false` en App Runner staging/prod (rolling
     restart, ~3 min).
   - Verifica que `insureds-creation-worker` y `pdf-worker` no emitan
     `certificate.issued` en CloudWatch Logs (5 min sin nuevas líneas
     `event=certificate.issued`).

3. **Drain la cola legacy** (`<env>-certificates`):
   ```bash
   QUEUE_URL=$(aws sqs get-queue-url \
     --queue-name segurasist-{env}-certificates \
     --query 'QueueUrl' --output text)

   # Loop hasta que ambos counters sean 0
   while true; do
     ATTRS=$(aws sqs get-queue-attributes \
       --queue-url "$QUEUE_URL" \
       --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
       --query 'Attributes' --output json)
     VISIBLE=$(echo "$ATTRS" | jq -r '.ApproximateNumberOfMessages')
     INFLIGHT=$(echo "$ATTRS" | jq -r '.ApproximateNumberOfMessagesNotVisible')
     echo "visible=$VISIBLE inflight=$INFLIGHT"
     [ "$VISIBLE" = "0" ] && [ "$INFLIGHT" = "0" ] && break
     sleep 30
   done
   ```
   El drain debe consumirse por el worker PDF normal (NO purge — perdería
   mensajes con clientes esperando certificado). Si el drain tarda
   >30 min, escalar a P1 (probable bug en consumer; ver RB-004).

4. **Verify DLQ empty** (`<env>-certificates-dlq`):
   ```bash
   DLQ_URL=$(aws sqs get-queue-url \
     --queue-name segurasist-{env}-certificates-dlq \
     --query 'QueueUrl' --output text)

   aws sqs get-queue-attributes \
     --queue-url "$DLQ_URL" \
     --attribute-names ApproximateNumberOfMessages
   ```
   Esperado: `0`. Si DLQ tiene mensajes:
   - **Triage**: ejecutar RB-004 primero (peek + reproducir + decidir
     redrive vs drop).
   - **Backup forense**: si vas a descartar, dump payloads a S3
     `s3://segurasist-{env}-audit-logs/dlq-snapshots/certificates-rename-{date}/`
     con `aws sqs receive-message` + `aws s3 cp` antes del destroy.
   - **NO aplicar el rename** hasta que DLQ esté en 0 (limpia o
     archivada).

5. **Backup snapshot** del estado pre-rename (audit trail):
   ```bash
   terraform state pull > /tmp/tfstate-pre-rename-{env}-{date}.json
   aws s3 cp /tmp/tfstate-pre-rename-{env}-{date}.json \
     s3://segurasist-{env}-audit-logs/tfstate-snapshots/
   ```

## Apply

1. **Ventana de mantenimiento**: declarar 30 min en staging,
   60 min en prod (con notificación a clientes B2B vía email + status
   page si existe).

2. **Apply Terraform**:
   ```bash
   cd segurasist-infra/envs/{staging|prod}
   terraform apply tfplan-rename.bin
   ```
   - Tiempo esperado destroy SQS: ~60 s/queue (60 s delete delay AWS).
   - Tiempo esperado create SQS: ~30 s/queue.

3. **Update env vars en App Runner**:
   - `SQS_QUEUE_PDF` ahora apunta a `https://sqs.{region}.amazonaws.com/{account}/segurasist-{env}-pdf`.
   - El módulo de Terraform expone el output `sqs_queue_urls["pdf"]`;
     el deploy de App Runner lo consume vía data source.
   - Rolling restart App Runner (~3 min) tras el apply.

4. **Re-enable workers**: `WORKERS_ENABLED=true` (otro rolling restart).

## Verify

1. **Queues exist**:
   ```bash
   aws sqs list-queues --queue-name-prefix segurasist-{env}-pdf
   # Debe listar: segurasist-{env}-pdf y segurasist-{env}-pdf-dlq
   aws sqs list-queues --queue-name-prefix segurasist-{env}-certificates
   # Debe estar vacío (legacy destruidas)
   ```

2. **Smoke test publisher → consumer**:
   - POST `/v1/insureds` (staging) que dispare un `insured.created` →
     verifica que llega a `<env>-pdf` (no `<env>-certificates`).
   - El PDF worker procesa y emite `certificate.issued` a
     `<env>-emails` (sin cambios).
   - Audit log muestra `certificate.issued` con `messageId` nuevo
     (queue ARN distinto).

3. **CloudWatch alarms**:
   - `segurasist-{env}-sqs-pdf-dlq-depth` debe transicionar de
     `INSUFFICIENT_DATA` a `OK` en ≤15 min (después de la primera
     publicación a la cola nueva).
   - `segurasist-{env}-sqs-certificates-dlq-depth` queda como recurso
     huérfano en CloudWatch — eliminar manualmente con
     `aws cloudwatch delete-alarms` o vía Terraform en el siguiente
     apply (la alarma definition desaparece junto con
     `for_each = local.queues` después del rename).

4. **Validation gate orchestrator**:
   ```bash
   cd segurasist-api && pnpm test -- sqs webhook
   cd segurasist-infra && terraform -chdir=modules/sqs-queue validate
   ```

## Postmortem checklist

- [ ] Tiempo total de la ventana (drain + apply + verify).
- [ ] # mensajes drenados de `<env>-certificates` antes del destroy.
- [ ] # mensajes en DLQ legacy: redriveados / archivados a S3 /
      descartados.
- [ ] Customer impact: # PDFs retrasados durante la ventana
      (App Runner pause). Comunicación enviada a B2B clients.
- [ ] Validar que `env.SQS_QUEUE_PDF` propagó a App Runner sin manual
      override (debería venir del Terraform output).
- [ ] Lecciones: ¿podríamos haber usado `terraform state mv` para evitar
      destroy? Análisis: NO — `aws_sqs_queue` no soporta rename en
      AWS API, requiere create/destroy. Documentar en ADR si Sprint 6
      necesita rename de otra cola.
- [ ] Update CloudWatch alarmas legacy (eliminar referencias a
      `<env>-certificates-dlq-depth` si quedaron orphan).
- [ ] Confirmar que NO quedan referencias a `certificates` queue en
      código (búsqueda: `grep -rn "certificates-queue\|<env>-certificates"
      segurasist-api/src/`). Si encuentra hits → bug, escalar a F4/F5.

## Rollback

Si el apply falla (error en módulo `sqs-queue` o IAM permission gap):

1. Las colas legacy `<env>-certificates*` ya pueden estar destruidas
   (Terraform aplica destroy ANTES de create por default). Recovery:
   ```bash
   terraform apply -target=module.sqs[\"pdf\"] -auto-approve
   ```
   Forzar create de las nuevas (workers vuelven a operar contra `<env>-pdf`).

2. Si las nuevas tampoco se crearon (IAM/KMS issue):
   - Restaurar tfstate desde snapshot S3 (paso 5 pre-apply).
   - **Manual recreate** de `<env>-certificates*` con `aws sqs create-queue`
     usando los attributes del snapshot (visibility timeout, redrive
     policy, KMS key).
   - App Runner sigue apuntando a la queue legacy (env var sin cambio).
   - Investigar root cause del IAM/KMS gap antes de re-intentar.

3. Comunicar a clientes B2B la extensión de la ventana de mantenimiento.
