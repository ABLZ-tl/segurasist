# RB-004 — SQS DLQ depth > 0

- **Severity**: P2
- **On-call SLA**: acknowledge ≤ 30 min, resolve ≤ 8 h
- **Owner**: DevOps on-call + worker owner (PDF / email / layout / reports)
- **Triggered by**: CloudWatch alarm
  `segurasist-{env}-sqs-{queue}-dlq-depth` (>0 messages 5 min)
- **Related**: RB-007 (audit degraded), C-09 (SQS dedupeId removal)

## Symptom

- Una o más colas tienen mensajes en DLQ (`-dlq` suffix):
  - `segurasist-{env}-layout-dlq` → batches stuck en `validating`.
  - `segurasist-{env}-certificates-dlq` → certs no se emiten.
  - `segurasist-{env}-emails-dlq` → emails no salen.
  - `segurasist-{env}-reports-dlq` → exports cuelgan.
- Workers en App Runner / Lambda muestran retries excediendo
  `maxReceiveCount = 5`.

## Detection

| Source | Metric |
|---|---|
| CloudWatch alarm | `segurasist-{env}-sqs-{queue}-dlq-depth` |
| AWS Console SQS | DLQ `ApproximateNumberOfMessagesVisible > 0` |
| Pino logs (worker) | `[FATAL] message moved to DLQ after N retries` |

## Triage (≤ 5 min)

1. Identificar queue afectada (alarma trae `Queue=<name>` tag).
2. Inspeccionar primer mensaje SIN deletearlo (peek):
   ```bash
   aws sqs receive-message \
     --queue-url $(terraform output -raw sqs_queue_urls | jq -r '.["{queue}"]_dlq') \
     --max-number-of-messages 1 \
     --visibility-timeout 0 \
     --message-attribute-names All
   ```
3. Anotar `MessageId` + `ApproximateReceiveCount`. Capturar payload
   en ticket post-mortem (con tenant_id redactado si PII).

## Mitigation

1. **Reproducir falla en local**:
   - Construir payload exacto desde DLQ → enviar al worker en LocalStack.
   - Identificar excepción raíz (parse error / RDS FK / S3 access denied / Cognito 5xx).
2. **Hot-fix categorías comunes**:
   - **Schema validation** (Zod): payload vino con campo extra/missing.
     Causa típica: feature flag publisher antes que consumer. Fix:
     subir versión consumer + redrive.
   - **Tenant deleted**: insurer/insured ya no existe. Fix: skip + log
     (no reintentar). Editar worker para `try/catch` con `notFound = ok`.
   - **External 5xx** (Cognito / SES throttle): backoff transitorio.
     Worker debería retry ya, llegada a DLQ implica >5 fallos en
     `max_receive_count`. Verificar baseline de error rate del provider.
   - **Bug código**: arreglar en branch + deploy + redrive.
3. **Redrive (post-fix)** — usar AWS Console SQS o CLI:
   ```bash
   aws sqs start-message-move-task \
     --source-arn $(terraform output -raw sqs_queue_arns | jq -r '.["{queue}"]_dlq')
   ```
   Verifica que la cola main no se sature (rate limit `--max-receive-message-rate`).
4. Si payload es **non-recoverable** (corrupto, payload malicioso):
   `aws sqs delete-message --receipt-handle <handle>`. Anotar en
   audit log con `audit.action=DLQ_DROP`.

## Root cause investigation

- Buscar correlación con deploy reciente del worker o publisher.
- Check si **dedupeId** tras C-09 fue removido correctamente: si llega a
  standard queue con `MessageDeduplicationId`, AWS rechaza
  `InvalidParameterValue` → mensaje termina en DLQ (publisher lado).
- Cross-link C-07 (TOCTOU completed twice) si la queue es `certificates`
  y mensajes son duplicados pero el worker IDempotency-guard rechaza.

## Postmortem checklist

- [ ] Categoría root cause (schema / external / bug / poison message).
- [ ] # mensajes redriveados con éxito vs descartados.
- [ ] Customer impact: # certificados/emails/exports retrasados.
- [ ] Prevention: ¿test E2E que cubre el path? ¿alarm earlier (depth >0
      but `<5` para detectar antes de saturar DLQ)?
- [ ] Verificar si necesita actualizar runbook (nueva clase de fallo).
