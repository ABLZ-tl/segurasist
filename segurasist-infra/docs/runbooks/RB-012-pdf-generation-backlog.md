# RB-012 — PDF generation backlog

- **Severity**: P2 (cliente afectado — certificados emitidos no llegan
  por email; batches `completed` pero PDFs sin generar; cumplimiento
  contractual con Hospitales MAC en riesgo si lag > 4 h)
- **On-call SLA**: acknowledge ≤ 30 min, resolve ≤ 4 h
- **Owner**: DevOps on-call + Backend Lead (módulo `certificates` /
  `lambda_pdf` renderer)
- **Triggered by** (any of):
  - CloudWatch alarm `segurasist-{env}-sqs-pdf-dlq-depth > 0`
  - CloudWatch alarm `segurasist-{env}-lambda-pdf_renderer-errors > 0`
  - Síntoma indirecto: `Certificate.pdf_url IS NULL` en filas con
    `created_at < NOW() - INTERVAL '15 min'` y `status='issued'`.
  - Ticket cliente: "no me llegó el certificado" / "el botón Descargar
    PDF dice que el archivo no existe".
- **Related**: RB-004 (SQS DLQ general), RB-011 (batch stuck —
  upstream del flujo certificate generation), RB-007 (audit degraded
  — el PDF SHA chain depende de audit healthy), C-01 (Certificate.hash
  PDF SHA real).

> **Numeración**: este slug `RB-012-pdf-generation-backlog` fue
> reclamado por el audit Sprint 5; previamente el slot `RB-012` estaba
> ocupado por el runbook WAF rules, ahora reubicado en
> `RB-016-waf-rules.md` (F8 iter 2).

## What this means

Pipeline:

```
Certificate created (DB row, status='issued', pdf_url=null)
     ↓ enqueue → SQS pdf
     ↓ Lambda pdf_renderer (Chromium headless)
     ↓ S3 PutObject certificates bucket (KMS encrypted)
     ↓ UPDATE certificates SET pdf_url=<presigned>, hash=<sha256>
     ↓ enqueue → SQS emails
     ↓ Lambda emailer (SES)
```

**Backlog** = `pdf` queue depth crece más rápido que el throughput de
`lambda_pdf`. Causas comunes:

- **Lambda concurrency cap** alcanzado (default reserved = 10 en dev;
  prod usa quota cuenta = 1000 — verificar service quotas).
- **Chromium cold start** (>2 s adicionales por invocación fría):
  bursts de batches grandes saturan.
- **KMS throttle** (`kms:GenerateDataKey` para SSE-KMS S3): cuenta
  joven < 30 días tiene quota baja.
- **Plantilla HTML rota** (commit reciente cambió template Handlebars
  con sintaxis inválida): TODO PDF falla en render.

## Triage (≤ 5 min)

1. Confirmar la naturaleza del problema:
   ```bash
   aws sqs get-queue-attributes \
     --queue-url $(terraform -chdir=envs/{env} output -raw sqs_pdf_url) \
     --attribute-names \
       ApproximateNumberOfMessagesVisible \
       ApproximateNumberOfMessagesNotVisible \
       ApproximateNumberOfMessagesDelayed
   ```
   - **Visible alto + DLQ vacía** → backlog "puro" (capacidad). Flujo A.
   - **Visible bajo + DLQ alta** → render failing. Flujo B.
   - **NotVisible alto sostenido** → invocaciones in-flight pero nunca
     ack: Lambda timeout. Flujo C.

2. Lambda errors:
   ```bash
   aws lambda get-function \
     --function-name segurasist-{env}-pdf-renderer \
     --query 'Configuration.[Timeout,MemorySize,ReservedConcurrentExecutions]'
   aws logs filter-log-events \
     --log-group-name /aws/lambda/segurasist-{env}-pdf-renderer \
     --start-time $(($(date +%s) - 900))000 \
     --filter-pattern '"ERROR" OR "Task timed out"'
   ```

3. Estimar lag operacional:
   ```sql
   SELECT count(*) AS pending,
          NOW() - MIN(created_at) AS oldest_pending
     FROM certificates
    WHERE pdf_url IS NULL
      AND status='issued'
      AND created_at < NOW() - INTERVAL '5 minutes';
   ```
   Si `oldest_pending > 30 min` → P2 confirmado; si > 4 h → escalar P1.

## Mitigation — Flujo A (capacidad / backlog "puro")

1. **Bumpear concurrency Lambda** temporalmente (no requiere PR para
   medidas de < 24 h):
   ```bash
   aws lambda put-function-concurrency \
     --function-name segurasist-{env}-pdf-renderer \
     --reserved-concurrent-executions 50    # antes 10
   ```
   > WARN: el cambio se sobrescribe en el próximo `terraform apply`
   > si el módulo no lo refleja. Abrir PR a `segurasist-infra` con
   > el cambio definitivo en `< 24 h`.
2. Verificar que la cola drena: `Visible` debe descender ~10 msg/min
   con concurrency=50 (cada invocación ~3-5 s incluyendo cold start).
3. Si la quota cuenta Lambda concurrent total está topeada (1000 prod,
   100 dev) → solicitar service quota bump (AWS Support, ~24-48 h).

## Mitigation — Flujo B (render failing — DLQ creciendo)

1. Peek mensaje DLQ:
   ```bash
   aws sqs receive-message \
     --queue-url $(terraform output -raw sqs_pdf_dlq_url) \
     --max-number-of-messages 1 \
     --visibility-timeout 0
   ```
   Anotar `certificateId` + `tenantId` del body.
2. Intentar render local con el mismo payload:
   ```bash
   ./scripts/pdf-renderer-local.sh --certificate-id <id> --dry-run
   ```
3. Causas típicas:
   - **Plantilla rota**: revertir el último PR que tocó
     `segurasist-api/templates/certificate-*.hbs` o
     `lambdas/pdf-renderer/templates/`.
   - **PII inesperada** (e.g., un `insured.name` con caracteres
     control): el template debe escapar; agregar `{{escape}}` helper.
   - **KMS throttle**: ver `AWS/KMS ThrottleCount` por key
     `alias/segurasist-{env}-general`. Si > 0, solicitar quota bump
     o reducir paralelismo Lambda temporalmente.
4. Re-drive DLQ cuando el fix esté en main:
   ```bash
   aws sqs start-message-move-task \
     --source-arn $(terraform output -raw sqs_pdf_dlq_arn) \
     --max-number-of-messages-per-second 5
   ```

## Mitigation — Flujo C (Lambda timeout)

1. Revisar `Duration` p99 últimos 30 min en CloudWatch:
   ```bash
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Lambda \
     --metric-name Duration \
     --dimensions Name=FunctionName,Value=segurasist-{env}-pdf-renderer \
     --start-time $(date -u -v-30M +%FT%TZ) \
     --end-time $(date -u +%FT%TZ) \
     --period 60 \
     --statistics Average,Maximum,p99 \
     --extended-statistics p99
   ```
2. Si `p99 > 80% del timeout configurado` → bump:
   ```bash
   aws lambda update-function-configuration \
     --function-name segurasist-{env}-pdf-renderer \
     --timeout 60     # antes 30
     --memory-size 2048   # antes 1024 (CPU escala con memoria)
   ```
3. Causa subyacente típica: Chromium relanzando assets remotos
   (font CDN). Solución definitiva: bundle fonts en el deployment
   package + `--font-render-hinting=none`.

## Recovery — backfill PDFs faltantes

Una vez la pipeline está sana, los certificados con
`pdf_url IS NULL` quedan huérfanos. Backfill:

```sql
-- Cantidad afectada
SELECT count(*) FROM certificates
 WHERE pdf_url IS NULL AND status='issued';
```

```bash
# Re-encolar los huérfanos al queue pdf:
./scripts/certificates-backfill-pdf.sh \
  --env {env} --since '24 hours ago'
```

El script lee la lista de `certificate_id` con `pdf_url IS NULL` y
hace `SendMessageBatch` (10 msg/batch) hasta el `pdf` queue. Los
workers son idempotentes por `(certificate_id, hash IS NULL)` — si
el render ya completó, el segundo intento no duplica.

## Communication

- **Si lag > 1 h en prod**: notificar customer success → mensaje
  proactivo a operadores MAC afectados ("El sistema está procesando
  un volumen elevado de certificados; la entrega por email puede
  retrasarse hasta XX min").
- **Si lag > 4 h**: status page incident público
  (`status.segurasist.app`) + escalación CTO.
- **NO comunicar fix antes** de validar que el queue drenó a `< 10
  msg visible` durante ≥ 5 min sostenido.

## Postmortem checklist

- [ ] Pico de queue depth (Visible + NotVisible).
- [ ] Tiempo total de backlog (desde primer mensaje retrasado hasta
      drain completo).
- [ ] # certificados afectados (pdf_url null durante el incidente).
- [ ] # tenants impactados.
- [ ] Categoría: capacity / template bug / KMS throttle / Lambda
      timeout / cold-start storm.
- [ ] Detection gap: ¿alarma `lambda-pdf_renderer-errors` o
      `sqs-pdf-dlq-depth` disparó a tiempo? ¿hubo síntoma upstream
      (RB-011) que debimos haber correlacionado antes?
- [ ] Action items (≤ 2 semanas):
  - [ ] Si fue Flujo A repetido: subir `reserved_concurrent_executions`
        permanente vía Terraform (`modules/lambda-function`).
  - [ ] Si fue Flujo B (template): agregar test snapshot en CI que
        ejerza el render con un payload realista.
  - [ ] Si fue Flujo C (timeout): bump permanente memory/timeout +
        considerar pre-warming reserved concurrency.
  - [ ] Considerar custom metric `PdfRenderLagSeconds` (EMF) para
        que las alarmas anticipen backlog antes de DLQ.

## Métricas de tracking

- Queue depth p99 `pdf` por mes (objetivo prod: ≤ 50 msg).
- Tiempo medio detección → drain completo (objetivo: < 2 h).
- Lambda errors `pdf_renderer` / mes (objetivo: < 0.1 % invocaciones).
- # certificados con `pdf_url=null` > 1 h (objetivo: 0).

## Referencias

- `segurasist-api/src/modules/certificates/certificates.service.ts`
- `lambdas/pdf-renderer/` — Chromium headless renderer.
- `segurasist-infra/envs/{env}/main.tf` — `module.lambda_pdf` config.
- `segurasist-infra/modules/lambda-function/` — concurrency knobs.
- RB-004 (SQS DLQ general), RB-011 (batch stuck — upstream),
  RB-007 (audit chain integrity downstream).
