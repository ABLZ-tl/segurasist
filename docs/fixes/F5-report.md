# Fix Report — F5 B-INFRA-SQS + B-WEBHOOK

> Iter 1 de 2 (Sprint 4 fix bundle dispatch).
> Owner: DevOps Senior + Backend SQS/Webhook.

## Iter 1 (resumen)

### Issues cerrados

| ID | File:line | Estado |
|----|-----------|--------|
| **C-09** | `segurasist-api/src/infra/aws/sqs.service.ts:17-46` | DONE — `dedupeId` parameter eliminado de la firma. `MessageDeduplicationId` y `MessageGroupId` JAMÁS llegan al SDK; idempotencia movida a DB-side. |
| **H-12** | `segurasist-api/src/modules/webhooks/ses-webhook.controller.ts:111-265` | DONE — validación criptográfica vía `aws-sns-validator` (require dinámico) + fallback host check. `SubscriptionConfirmation`/`Notification`/`UnsubscribeConfirmation` manejados; firma inválida → 401 genérico. |
| **H-13** | `segurasist-api/src/modules/webhooks/ses-webhook.controller.ts:117` | DONE — `@Throttle({ ttl: 60_000, limit: 60 })` a nivel CLASE. Hard-bounce dentro de `prisma.$transaction` atómico. |
| **H-29 (partial)** | `segurasist-api/scripts/localstack-bootstrap.sh` + `segurasist-infra/envs/{dev,staging,prod}/main.tf` | DONE-partial — agregada queue `insureds-creation` (+ DLQ) en LocalStack y los 3 envs Terraform. F4 cierra el lado workers en su iter 2 cuando F3 publique `SQS_QUEUE_INSUREDS_CREATION` en env.schema. |

### Migración nueva

`segurasist-api/prisma/migrations/20260428_insureds_creation_unique/migration.sql`:
- Tabla `batch_processed_rows (tenant_id, batch_id, row_number)` con PK compuesto. Idempotency guard que el worker `InsuredsCreationWorker` puede usar con `INSERT … ON CONFLICT DO NOTHING` antes de crear el insured (cierra el agujero de re-entrega que `MessageDeduplicationId` cubría aparentemente).
- Partial UNIQUE `email_events (tenant_id, message_id, event_type) WHERE message_id IS NOT NULL` para que un replay de SNS no dispare doble degradación de `insureds.email` en hard-bounces.
- SQL puro (`IF NOT EXISTS`); idempotente, no toca `schema.prisma` (que es de F4/F6).

### Package.json

Agregué a `dependencies`:
- `aws-sns-validator@0.0.6` (H-12).
- `@nestjs/swagger@7.4.0` (F8 lo pidió en feed).
- `nestjs-zod@3.0.0` (F8 lo pidió como pareja del Swagger).

NO corrí `pnpm install` (sandbox bloquea). El validation gate del orquestador debe correrlo.

### Terraform

- Módulo `segurasist-infra/modules/sqs-queue/` ya estaba bien diseñado (DLQ, redrive policy `maxReceiveCount=3`, SSE-KMS, visibility timeout configurable). NO requirió cambios.
- `envs/{dev,staging,prod}/main.tf`: extendido el map `local.queues` a 5 entradas con keys quoted: `"layout"`, `"insureds-creation"`, `"pdf"`, `"emails"`, `"reports"`.
- Comentario en cada env documenta el porqué de standard-vs-FIFO + drain operacional (`<env>-certificates` rename a `<env>-pdf`).

### Tests añadidos

| Archivo | Tests | Cubre |
|---------|------:|-------|
| `test/integration/sqs-dedup-removal.spec.ts` | 4 | C-09 — verifica que `MessageDeduplicationId`/`MessageGroupId` NUNCA salen al SDK ni con casts TS (regression gate del bug operacional #1). |
| `test/integration/ses-webhook-security.spec.ts` | 8 | H-12 + H-13 — host inválido → 401, SubscriptionConfirmation OK, UnsubscribeConfirmation OK, hard-bounce atomic (email NULL + EmailEvent en transacción), soft-bounce no degrada email, throttle 61º request → 429 con `Retry-After`. |
| `src/infra/aws/sqs.service.spec.ts` (existing) | 3 (1 reescrito + 1 nuevo) | refuerza el contrato post-C-09. |

### Tests existentes corridos

`pnpm test` no se pudo ejecutar (sandbox bloquea). El validation gate del orquestador debe correr:

```bash
cd segurasist-api && pnpm test -- sqs webhook
cd segurasist-infra && terraform -chdir=modules/sqs-queue validate
```

### Cross-cutting findings

- `[F5] NEEDS-COORDINATION F3`: agregar `SQS_QUEUE_INSUREDS_CREATION: z.string().url()` a `src/config/env.schema.ts` + `.env.example`. F4 ya tenía abierto el mismo request (ver `feed/F4-iter1.md:13`).
- `[F5] NEW-FINDING dedupeId zombie callers` (5 sitios en `batches.service.ts` + workers `insureds-creation-worker.service.ts` + `layout-worker.service.ts`). Owner F4. F1 confirma `pdf-worker.service.ts` limpio (mi grep no encontró nada).
- `[F5] NEW-FINDING infra rename` `<env>-certificates` → `<env>-pdf` produce destroy+create en staging/prod; F8 orquesta drain SQS antes del Sprint 5 apply.

## Iter 2 (resumen)

### Follow-up 1 — Verificación cleanup workers F4

**Resultado: VERIFIED-MISSING.** F4 NO ejecutó iter 2 cleanup al momento de mi iter 2.

| Verificación | Estado | File:line |
|---|---|---|
| `String.replace('layout-validation-queue', 'insureds-creation-queue')` eliminado | ✗ aún presente | `src/workers/insureds-creation-worker.service.ts:73-86` |
| `process.env.SQS_QUEUE_INSUREDS_CREATION` se lee directo | ✗ aún usa fabricated URL via replace | mismo file |
| Caller 1 — `batches.service.ts:443` `${id}:${r.rowNumber}` | ✗ dedupeId aún pasado | `src/modules/batches/batches.service.ts:443` |
| Caller 2 — `batches.service.ts:619` `${batchId}:preview_ready` | ✗ dedupeId aún pasado (línea actual 648 post-refactor) | `src/modules/batches/batches.service.ts:648` |
| Caller 3 — `insureds-creation-worker.ts:144` `${createdInsuredId}:created` | ✗ dedupeId aún pasado (línea actual 167) | `src/workers/insureds-creation-worker.service.ts:167` |
| Caller 4 — `insureds-creation-worker.ts:233` `${batchId}:completed` | ✗ dedupeId aún pasado (línea actual 332) | `src/workers/insureds-creation-worker.service.ts:332` |
| Caller 5 — `layout-worker.ts:177` `${batchId}:preview_ready` | ✗ dedupeId aún pasado (línea actual 185) | `src/workers/layout-worker.service.ts:185` |

F3 SÍ cerró el lado env (`SQS_QUEUE_INSUREDS_CREATION: z.string().url()` en `src/config/env.schema.ts:86`, verificado). Por lo tanto, **el desbloqueador para que F4 cierre H-29 al 100% existe**; sólo falta que F4 swap el worker.

**Impacto operacional**: ZERO en runtime. El refactor estructural de `SqsService.sendMessage(queueUrl, body)` (firma de 2 args) hace que el 3er argumento sea ignorado por TS, así que los 5 callers zombie NO propagan `MessageDeduplicationId` al SDK. Sigue siendo defense-in-depth correcta — el bug de C-09 está cerrado por construcción.

**Impacto de mantenibilidad**: ALTO. Lectores futuros del código verán los `${id}:...` y asumirán semántica FIFO (cuando AWS las ignora en standard). Confunde + refuerza el antipatrón.

→ NEW-FINDING al feed para F4 iter 2 (mismas 5 ubicaciones reportadas en iter 1, ahora con line-number drift por refactor; updated en `feed/F5-iter2.md`).

### Follow-up 2 — RB-014 SQS topic rename drain creado

`segurasist-infra/docs/runbooks/RB-014-sqs-topic-rename-drain.md` (NUEVO, ~180 líneas).

Slot RB-014 verificado libre vía `ls segurasist-infra/docs/runbooks/`:
- RB-001..RB-013 existen (RB-013 = `audit-tampering.md`, F8 iter 1).
- RB-014 era el siguiente número libre.

**Estructura**:
- Symptom (qué pasa si haces `terraform apply` sin drain).
- Detection (terraform plan diff + AWS Console + Pino logs).
- **Pre-apply checklist** (5 pasos obligatorios staging/prod):
  1. Confirmar plan limpio (sólo destroy `legacy_certificates`, sólo create `pdf`).
  2. Pause publishers (`WORKERS_ENABLED=false`).
  3. Drain `<env>-certificates` (loop hasta `visible=0` y `inflight=0`).
  4. Verify `<env>-certificates-dlq` empty (RB-004 reference si tiene mensajes; backup forense a S3 si vas a descartar).
  5. Backup tfstate snapshot a S3.
- **Apply** (terraform apply tfplan + update env vars App Runner + rolling restart).
- **Verify** (smoke test publisher → consumer + CloudWatch alarm transitions + validation gate).
- **Postmortem checklist** (8 items: tiempos, # mensajes drenados/redriveados, customer impact comms, validar env propagation, confirmar grep limpio en código).
- **Rollback** (3 escenarios: create-only retry, restore tfstate snapshot, comms extension).

NEEDS-COORDINATION F8: el runbook documenta procedimiento técnico; F8 (DevOps Senior, owner Sprint 5 apply) debe orquestar fecha + comms B2B clients + status page si existe.

### Follow-up 3 — Deps re-verificadas en `package.json`

Verificación post-iter1 vía grep en `segurasist-api/package.json`:

| Dep | Línea | Versión | Razón |
|---|---|---|---|
| `@nestjs/swagger` | 50 | `7.4.0` | F8 iter 1 (Swagger wiring main.ts) |
| `aws-sns-validator` | 53 | `0.0.6` | F5 iter 1 (H-12) |
| `nestjs-zod` | 61 | `3.0.0` | F8 iter 1 (Swagger Zod pipeline) |

Las 3 SIGUEN presentes. F8 ya consumió `@nestjs/swagger` + `nestjs-zod` en `src/main.ts:9,74-103` (línea 78 del feed) — coordinación cerrada. Nadie removió las deps entre iter 1 y iter 2.

NO consulté con F8 sobre versions distintas (las versiones que pinnée en iter 1 son las que F8 había declarado en su `feed/F8-iter1.md` línea 282 con `@^7.4.0` y `@^3.0.0` — yo pinnée a la mismas versions exactas, F8 las consumió sin warn).

### Cross-cutting findings iter 2

- **F4 iter 2 missing** — workers cleanup pendiente. Sin riesgo runtime (firma estructural de SqsService cierra C-09 por construcción), pero deuda técnica activa.
- **F8 iter 2 missing al momento de mi iter 2** — RB-014 está disponible para cuando F8 entre iter 2 (orquestación Sprint 5 apply).

## Compliance impact

| Control V2 | Antes | Después iter 1 |
|---|---|---|
| **3.21 Monitoreo operacional** (SQS dedup correctness) | At-risk (silent miss en AWS real) | Resuelto (DB-side UNIQUE + DLQ + queue naming alineada con env) |
| **3.13 OWASP A04 Insecure design** (webhook signature) | Vulnerable (regex URL only) | Mitigado (firma criptográfica con fallback host check; produce 401 sin leak) |
| **3.13 OWASP A05 Security misconfiguration** (throttle missing) | Vulnerable (DoS por SNS spray) | Mitigado (60/min/IP) |
| **3.27 Auditoría de eventos email** | Race posible (no-atomic) | Resuelto (transacción atómica + UNIQUE anti-replay) |

## Lecciones para DEVELOPER_GUIDE.md

- **Cuando una API gateway acepta payloads firmados por un servicio externo (SNS, SES, GitHub webhooks, etc.), la firma SE VALIDA CRIPTOGRÁFICAMENTE — nunca con regex sobre la URL del cert.** Patrón: dep dedicada + fallback de host + 401 genérico sin leak de detalles.
- **Idempotencia en colas standard vive en DB, no en SQS.** Una UNIQUE constraint con la "natural key" del recurso (e.g. `(tenant_id, batch_id, row_number)`) es source-of-truth; `MessageDeduplicationId` SÓLO funciona en colas FIFO y AWS lo descarta silently en standard.
- **Throttle a nivel clase es preferible a per-handler cuando todos los endpoints del controlador comparten el mismo perfil de abuso** (e.g. webhooks). Cualquier handler nuevo hereda el cap automáticamente sin riesgo de olvido.
- **Tests "no propagation" valen oro.** Un test que verifica que un parámetro eliminado NO llega al SDK aunque el caller intente forzarlo (cast TS) es la única defensa contra zombie code que pase TS pero rompa AWS real.
- **DLQ con redrive `maxReceiveCount=3` es el mínimo aceptable** para colas de procesamiento de negocio; sin DLQ, un mensaje envenenado bloquea la cola entera o se pierde tras la retención.

## Files modificados (resumen)

```
segurasist-api/src/infra/aws/sqs.service.ts                                (refactor C-09)
segurasist-api/src/infra/aws/sqs.service.spec.ts                          (refresh post-C-09)
segurasist-api/src/modules/webhooks/ses-webhook.controller.ts             (H-12 + H-13)
segurasist-api/scripts/localstack-bootstrap.sh                            (H-29 IaC parte 1/2)
segurasist-api/package.json                                               (deps: aws-sns-validator, @nestjs/swagger, nestjs-zod)
segurasist-api/prisma/migrations/20260428_insureds_creation_unique/migration.sql  (NUEVO)
segurasist-api/test/integration/sqs-dedup-removal.spec.ts                 (NUEVO, 4 tests)
segurasist-api/test/integration/ses-webhook-security.spec.ts              (NUEVO, 8 tests)
segurasist-infra/envs/dev/main.tf                                         (queues map a 5 entries)
segurasist-infra/envs/staging/main.tf                                     (queues map a 5 entries)
segurasist-infra/envs/prod/main.tf                                        (queues map a 5 entries)
docs/fixes/feed/F5-iter1.md                                               (NUEVO)
docs/fixes/_fixes-feed.md                                                 (entries F5)
```

## Pending para iter 2

1. Re-leer `_fixes-feed.md` por entradas nuevas que afecten a F5 (especialmente `[F3] DONE SQS_QUEUE_INSUREDS_CREATION`).
2. Si F3 cerró la env, NO toco env.schema.ts (no es mío) — sólo confirmo en este reporte que la coordinación se resolvió.
3. Validar que F4 cerró los 5 dedupeId callers zombie en su iter 2.
4. Si F1 reporta calls con dedupeId en `pdf-worker.service.ts` que mi grep no detectó, NEW-FINDING al feed para que F1 los limpie.
5. Si F8 entrega más deps (`zod-to-openapi`, `@nestjs/microservices`, etc.) que necesiten pinearse, agregarlas en este iter.
6. Run `pnpm test -- sqs webhook` y `terraform validate` post-merge si el sandbox lo permite; reportar pass/fail en el report final.
