# RB-014 — Monthly Reports Replay

> **Severity**: P2 (alarm fires) → escalates to P1 if multiple tenants impacted or repeat firings within 7d.
> **On-call SLA**: ack ≤ 15 min; mitigate ≤ 4 h.
> **Owner**: DevOps Senior + Backend Reports owner (S1/S3 owners post-Sprint 4).
> **Related**: RB-004 (SQS DLQ), RB-007 (Audit degraded), ADR-0003 (SQS dedupe policy), ADR-0006 (CW alarms cardinality).
> **Created**: Sprint 4 closure (S10 consolidador). Triggered by S3 NEW-FINDING (cron alarm wired in `alarms.tf` apuntaba a un RB-014 inexistente).

> **NOTA NUMERACIÓN**: Coexiste con `RB-014-sqs-topic-rename-drain.md` (Sprint 5 planned change). El mapa `queue_runbooks` en `segurasist-infra/envs/{env}/alarms.tf:172` apunta a `"monthly-reports" = "RB-014"`. Sprint 5: consolidar a `RB-019-monthly-reports-replay.md` y deprecar `RB-014-sqs-topic-rename-drain.md` post-rename apply.

---

## Symptom

Una o varias de las siguientes señales:

1. **CloudWatch alarm**: `${env}-cron-monthly-reports-failed` (namespace `AWS/Events`, métrica `FailedInvocations` ≥ 1, periodo 5min) en estado **ALARM** en `mx-central-1` (dev/staging/prod). Alarma definida en `segurasist-infra/envs/{env}/alarms.tf:419`.
2. **DLQ depth > 0**: cola `${env}-monthly-reports-dlq` (alarm preexistente del módulo `sqs-queue`) reporta mensajes — el handler `MonthlyReportsHandlerService` falló >3 veces consecutivas en algún mensaje.
3. **Tenants reportan**: emails de reporte conciliación NO recibidos día 1 del mes (≥3 h tras horario esperado 14:00 UTC = 08:00 CST).
4. **Tabla**: filas en `monthly_report_runs` con `status = 'failed'` para período `(YYYY, MM)` actual.

---

## Triage (≤ 15 min)

### Paso 1 — confirmar alcance

```sql
-- Conexión read-only a RDS prod (RB-002 §Access)
SELECT tenant_id, period_year, period_month, status, error_message, attempt_count, last_attempted_at
  FROM monthly_report_runs
 WHERE period_year = EXTRACT(YEAR FROM (CURRENT_DATE - INTERVAL '1 month'))::int
   AND period_month = EXTRACT(MONTH FROM (CURRENT_DATE - INTERVAL '1 month'))::int
   AND status IN ('failed', 'processing')
 ORDER BY tenant_id;
```

**Identifica**:
- N tenants afectados.
- Patrón en `error_message` (¿SES rate limit común? ¿RDS timeout repetido? ¿generador no implementado?).
- `attempt_count`: si llegó a 3 → mensaje en DLQ.

### Paso 2 — clasificar root cause

Checklist (marcar en post-mortem):

- [ ] **SES rate limit / sandbox**: SES en `mx-central-1` con sending quota agotada o cuenta en sandbox (solo verified emails). Síntoma: `error_message` contiene `Throttling` o `MessageRejected: Email address is not verified`.
- [ ] **S3 access denied**: bucket `${env}-segurasist-reports` con bucket policy o SCP block. Síntoma: `error_message` contiene `AccessDenied` o `403`.
- [ ] **RDS timeout**: query `getConciliacionReport` colgada por contención (CPU > 90%, lock waits). Síntoma: `error_message` contiene `Connection terminated`, `statement timeout`. Correlaciona con RB-002 (RDS CPU high).
- [ ] **Generador NotImplemented**: caller invoca el DI token `MONTHLY_REPORT_GENERATOR` y recibe el stub default (`NotImplementedError`). Síntoma específico Sprint 4 si S1 no completó el provider real iter 2. `error_message: 'monthly_report_generator_not_implemented'`.
- [ ] **App Runner down**: el handler corre en App Runner; si está degradado el poll loop no consume. Correlaciona con RB-001 (API down).
- [ ] **EventBridge rule disabled**: alguien (humano o IaC drift) deshabilitó la rule. `aws events describe-rule --name ${env}-monthly-reports` → `State: DISABLED`.

### Paso 3 — decidir acción

| Root cause | Acción |
|---|---|
| SES rate limit | Solicitar production access SES (~24-48h) + esperar; mientras, replay manual una vez la cuota recargue. |
| S3 access denied | Revisar `aws_s3_bucket_policy` + SCP en `segurasist-infra/envs/${env}`. Re-apply terraform si drift. Replay tras fix. |
| RDS timeout | Aplicar mitigación RB-002 (scale up RDS / kill long queries); aumentar `statement_timeout` para el role del worker temporalmente; replay. |
| Generador NotImplemented | NO replay hasta que S1 deploye el provider. Comunicar a producto el delay; replay manual planeado. |
| App Runner down | Aplicar RB-001; replay automático tras recuperación (los mensajes SQS quedan en queue hasta `VisibilityTimeout`). |
| Rule disabled | `aws events enable-rule --name ${env}-monthly-reports` + auditar logs CloudTrail (`UpdateRule` evento). |

---

## Mitigation

### Opción A — Re-trigger del cron completo (idempotente, recomendado)

Re-emite el evento EventBridge → SQS → handler. La idempotencia DB-side (`UNIQUE (tenant_id, period_year, period_month)` + catch P2002) garantiza que tenants completed se saltan; solo se re-procesan failed.

```bash
# Determinar período afectado (mes anterior por convención del cron)
YEAR=$(date -u -d "$(date +%Y-%m-01) -1 day" +%Y)
MONTH=$(date -u -d "$(date +%Y-%m-01) -1 day" +%m)
ENV=prod  # o staging/dev

aws events put-events \
  --region mx-central-1 \
  --entries '[{
    "Source": "segurasist.cron.manual",
    "DetailType": "monthly-reports-trigger",
    "Detail": "{\"kind\":\"cron.monthly_reports\",\"schemaVersion\":1,\"triggeredBy\":\"manual\",\"period\":{\"year\":'"$YEAR"',\"month\":'"$MONTH"'}}",
    "EventBusName": "default"
  }]'
```

**Verificación post-trigger** (≤ 15 min):

```sql
SELECT status, COUNT(*) FROM monthly_report_runs
 WHERE period_year = :year AND period_month = :month GROUP BY status;
-- Esperado: completed >> failed, processing == 0 tras 10min.
```

### Opción B — Forzar re-emit por tenant (libera UNIQUE)

Solo si Opción A no aplica (ej. el reporte se generó pero el email se perdió, o cambió la lógica del generador y se requiere re-render).

```sql
-- ⚠️ CAVEAT: si la corrida original ya envió email con éxito,
-- esto produce DUPLICADO (asegurados/MAC reciben 2 emails).
-- Confirmar con producto antes de ejecutar en prod.
DELETE FROM monthly_report_runs
 WHERE tenant_id = :tenant_id::uuid
   AND period_year = :year
   AND period_month = :month;
```

Tras DELETE, ejecutar Opción A para que la rule re-genere — el INSERT funciona porque la fila se borró.

**Alternativa "soft" (Sprint 5+)**: agregar campo `version` al modelo (Sprint 5 backlog) y usar UNIQUE compuesta `(tenant_id, period_year, period_month, version)` permite re-render sin DELETE. Hoy NO disponible.

### Opción C — Replay desde DLQ

Si el mensaje quedó en DLQ tras 3 intentos:

```bash
# Copiar mensajes DLQ → main queue (re-drive)
aws sqs start-message-move-task \
  --region mx-central-1 \
  --source-arn arn:aws:sqs:mx-central-1:${ACCOUNT_ID}:${ENV}-monthly-reports-dlq \
  --destination-arn arn:aws:sqs:mx-central-1:${ACCOUNT_ID}:${ENV}-monthly-reports
```

Solo válido si el root cause se mitigó previamente (SES quota recargada, S3 policy fix aplicado, etc.). Si no, los mensajes vuelven a DLQ tras `maxReceiveCount=3`.

---

## Rollback / Containment

Si el replay produce mass-emailing duplicado o consumo SES descontrolado:

1. **Pausar EventBridge rule**: `aws events disable-rule --name ${env}-monthly-reports`.
2. **Pausar handler**: scale-down App Runner workers a 0 (o env var `WORKERS_PAUSED=true` si implementado Sprint 5+).
3. **Audit**: query `audit_log WHERE action='create' AND resource_type='report.monthly' AND occurred_at > :timestamp` para identificar qué tenants recibieron duplicado.
4. **Comunicar**: producto + MAC notifican a tenants afectados; preparar correo "ignore the duplicate" en español formal.
5. **Re-habilitar rule** solo tras root cause confirmado fix.

---

## Postmortem (mandatorio si severidad fue P1)

Plantilla en `segurasist-infra/docs/postmortem-template.md` (Sprint 5 — TODO crear). Estructura mínima Sprint 4:

1. **Timeline**: hora alarma fired, hora ack, hora mitigación aplicada, hora resolución.
2. **Impacto**: # tenants afectados, # emails no enviados, ¿breach de SLA contractual?
3. **Root cause**: del checklist Triage §Paso 2.
4. **5-Whys**: por qué la causa, por qué no se detectó antes, por qué la alarma tardó N min.
5. **Action items con dueño + fecha**:
   - Fix técnico (ej. ajustar `statement_timeout`, solicitar SES production).
   - Detection improvement (ej. alarma adicional `MirrorLagSeconds` > 600s en DLQ).
   - Process (ej. añadir verificación day-1 manual al runbook on-call diario).
6. **Prevent recurrence**: link al PR que cierra los action items.

---

## Referencias

- `segurasist-infra/envs/{dev,staging,prod}/main.tf` — definición rule + queue.
- `segurasist-infra/envs/{dev,staging,prod}/alarms.tf:419` — alarm `cron-monthly-reports-failed`.
- `segurasist-infra/envs/{dev,staging,prod}/alarms.tf:172` — `queue_runbooks` map (`monthly-reports → RB-014`).
- `segurasist-api/src/modules/reports/cron/monthly-reports-handler.service.ts` — handler con poll loop + idempotencia P2002.
- `segurasist-api/src/modules/reports/cron/dto/monthly-report-event.dto.ts` — Zod schema del evento + `resolveReportedPeriod()`.
- `segurasist-api/prisma/migrations/20260428_monthly_report_runs/migration.sql` — modelo + UNIQUE + RLS.
- `docs/adr/ADR-0003-sqs-dedupe-policy.md` — Standard queues + DB UNIQUE como canonical.
- `docs/sprint4/S3-report.md` — implementación Sprint 4 + NEW-FINDINGs (TZ caveat, attachments SDK v3, queue policy pattern).
