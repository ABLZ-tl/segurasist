# Audit Report — Certificates + PDF + Email + SES (A4)

## Summary (≤10 líneas)

Área madura y bien estructurada. Pdf y Email son workers separados con SQS in-between, Puppeteer singleton lazy, plantillas Handlebars cacheadas (TTL 5min), adapter SES estrategia (SMTP/Mailpit en dev, SDK v3 en prod). Verify endpoint público bien aislado (BYPASSRLS, regex hash, no-PII, throttle 60/min). Tests sólidos en unit (Puppeteer mockeado, no descarga Chromium); integration `cert-email-flow` skippeado por flag (justificación documentada).

Issues principales: (1) **bug funcional crítico** — el `hash` persistido en DB es el `provisionalHash` random, NO el SHA-256 del PDF; el SHA-256 sólo queda en metadata S3. Esto rompe el invariante documentado en `events/certificate-events.ts` (`hash: SHA-256 hex del PDF generado`). (2) `SesService.sendViaSes` descarta los `tags`/`headers` (incl. `X-Tag-cert`) explícitamente — el webhook SES en prod NO podrá correlacionar eventos al certificado y la rama AWS pierde el `X-Trace-Id`. (3) El status `'failed'` se mapea a `'revoked'` (placeholder) — colapsa dos estados semánticamente distintos en queries downstream.

## Files audited

24 archivos, ~2150 LoC src + tests:

- `segurasist-api/src/modules/certificates/`: `certificates.controller.ts`, `certificates.service.ts`, `certificates.module.ts`, `puppeteer.service.ts`, `qr-generator.ts`, `template-resolver.ts`, `dto/certificate.dto.ts`, `templates/{default,mac}.hbs`, `certificates.service.spec.ts`.
- `segurasist-api/src/modules/email/`: `email-template-resolver.ts`, `bounce-alarm.service.ts`, `email.module.ts`, `templates/{certificate-issued,otp-code}.{html,txt}.hbs`.
- `segurasist-api/src/infra/aws/ses.service.ts` + `ses.service.spec.ts`.
- `segurasist-api/src/workers/`: `pdf-worker.service.ts`, `email-worker.service.ts`, `mailpit-tracker.service.ts`.
- `segurasist-api/src/modules/webhooks/`: `ses-webhook.controller.ts`, `webhooks.module.ts`, `webhooks.service.ts`.
- `segurasist-api/src/events/certificate-events.ts`.
- Tests `test/unit/modules/certificates/{pdf-worker,verify-endpoint,template-resolver,qr-generator}.spec.ts`, `test/unit/modules/email/{ses-adapter,email-worker,email-template-resolver}.spec.ts`, `test/integration/cert-email-flow.spec.ts`.

## Strengths (qué está bien hecho)

- **Adapter SES estrategia** (`SesService.send` + `resolveTransport`): dev/test → nodemailer Mailpit, staging/prod → SDK v3, override por `EMAIL_TRANSPORT`. Clean y testeado (`ses-adapter.spec.ts`).
- **Puppeteer warm singleton** con concurrency-safe (`warmupPromise`), lazy launch, `OnModuleDestroy` limpio; flags Docker correctos (`--no-sandbox`, `--disable-dev-shm-usage`); cada render usa `newPage` descartable (no leak de DOM/cookies entre tenants).
- **Cache de plantillas** TTL 5min en `TemplateResolver` y `EmailTemplateResolver` con allow-list `KNOWN` que evita path-traversal (`name → path.join`).
- **Verify endpoint público bien hardenado**: regex `^[a-f0-9]{64}$` antes de tocar BD, BYPASSRLS aislado, sólo devuelve nombre + paquete + fechas + tenant; `valid:false` uniforme en todos los failure modes (no leak forma del input). `@Throttle({ ttl: 60_000, limit: 60 })` aplicado y handler declarado primero (`/verify/:hash` antes de `:id` y `mine`) para evitar `ParseUUIDPipe`.
- **RBAC defensivo en service**: `urlForSelf` valida `user.role==='insured'` aún con `RolesGuard` arriba; `scopeForUser` cae a UUID-zero si falta `insuredId` claim (no leak otros certs).
- **Hard bounce → email NULL** automático en `ses-webhook.controller.ts`: degrada el insured a no-email para evitar reenvíos automáticos.
- **PII-safe verify** verificado por test (`verify-endpoint.spec.ts:67`) con regex contra response.
- **MailpitTracker bien aislado** (`NODE_ENV !== 'development'` → no schedule), idempotencia con Redis TTL 1d.
- **Concurrency safe** en `BounceAlarmService.checkAndAlert`: dedupe por `findFirst` antes de `create`.
- **Auto-confirm SubscriptionConfirmation** en webhook (`Type === 'SubscriptionConfirmation'` → `fetch(SubscribeURL)`).

## Issues found

| ID | File:line | Severity | Category | Description | Recommendation |
|---|---|---|---|---|---|
| A4-01 | `src/workers/pdf-worker.service.ts:316,357` | **Critical** | Clarity / Security | El comentario admite que `hash` persistido es `provisionalHash` (random `uuid+time`) no el SHA-256 del PDF; el SHA-256 vive sólo en S3 metadata `x-hash`. El JSDoc del evento (`certificate-events.ts:22`) afirma "SHA-256 hex del PDF generado" — contrato roto. Verificación de integridad declarada (recomputar SHA y comparar) **no es posible** con el dato en DB. | Persistir `pdfHash` en `certificates.hash` (lookup por SHA real) + `qrPayload` apuntando a ese mismo hash. Generar QR DESPUÉS de calcular SHA-256, re-render del PDF para embed (segunda pasada Puppeteer) o aceptar que el PDF firma incluye el hash en metadata XMP separado. Actualizar JSDoc del evento. |
| A4-02 | `src/infra/aws/ses.service.ts:154-155` | **High** | Pattern / Bug | `sendViaSes` descarta `headers` (`const _headersUnused = headers; void _headersUnused;`) y no inyecta `Tags` en el `SendEmailCommand`. En prod: el webhook SES no recibe el `X-Tag-cert` → `tagCert` siempre `null` → línea 118 `if (!tagCert) … ignorado`. Todos los eventos SES (Delivery/Bounce/Complaint) se descartarán silenciosamente. | Migrar a `SendRawEmailCommand` con MIME headers, o usar `Tags: [{Name:'cert',Value:certId}]` en `SendEmailCommand` (sí soportado en SDK v3). Mismo problema con `X-Trace-Id`. |
| A4-03 | `src/workers/pdf-worker.service.ts:282-294` | High | Maintainability / Clarity | Estado `failed` se persiste como `status:'revoked'` con `reason:'generation_failed: ...'`. Queries de admin que cuenten "revocados manuales" inflan con fallos de Puppeteer; reportes RF-3xx pueden mezclar ambos. El comentario reconoce el tradeoff pero no hay query/index dedicado. | Agregar literal `failed` al enum `CertificateStatus` (Prisma migration); o mantener `revoked` pero filtrar consistentemente con `reason LIKE 'generation_failed:%'` en métricas/reports. Documentar contrato en ADR. |
| A4-04 | `src/modules/webhooks/ses-webhook.controller.ts:76-85` | High | Security | En `production` se valida `SigningCertURL` regex (`sns\.[a-z0-9-]+\.amazonaws\.com`) pero NO se verifica criptográficamente la firma. TODO comentado para Sprint 5. Un atacante con conocimiento del topic ARN + cualquier cert SNS válido podría inyectar eventos (insureds.email = NULL via hard bounce fake). | Sprint 5: integrar `sns-validator` (npm) o port de algoritmo SHA1-RSA contra `SigningCertURL`. Mientras tanto, restringir el endpoint a IP allowlist VPC o requerir SNS topic privado. |
| A4-05 | `src/modules/webhooks/ses-webhook.controller.ts:67` | High | Security | `@Post('ses')` es `@Public()` sin `@Throttle`. POST público sin rate limit → DoS trivial. | Agregar `@Throttle({ttl:60_000,limit:120})` o similar. |
| A4-06 | `src/workers/pdf-worker.service.ts:308-311` | Medium | Clarity / Bug | Catch silencioso `try { sqs.sendMessage(...failedEvent) } catch { /* swallow */ }`: si SQS está caído + Puppeteer falla, NO se loggea el doble fallo. La fila DB existe pero ningún downstream lo sabe. | Loggear con `this.log.error` o re-throw después del DB write. |
| A4-07 | `src/modules/certificates/templates/mac.hbs:13-14,30,44` | Medium | Maintainability | Colores MAC hardcoded (`#0B5394`, `#4A90E2`) en CSS — no usa `{{tenant.colors.primary}}`. `default.hbs` sí lee del token (`tenant.colors.primary`). Si MAC quiere cambiar paleta, requiere PR. | Refactor `mac.hbs` a leer de `{{tenant.colors}}` con defaults via Handlebars helpers, o documentar que MAC tiene paleta fija intencional. |
| A4-08 | `src/modules/email/templates/otp-code.html.hbs:14,15,44` | Medium | Maintainability | Branding MAC hardcoded en plantilla "neutral" (`#0B5394`, "Mi Membresía MAC", "Hospitales MAC"). Si otro tenant usa OTP, el email dice "MAC" igual. | Parametrizar con `{{tenant.name}}`, `{{tenant.colors.primary}}` y default por tenant. |
| A4-09 | `src/workers/mailpit-tracker.service.ts:85` | Medium | Bug | Query Mailpit usa `tag%3Acert` (URL-encoded `tag:cert`). Mailpit interpreta esto como buscar la palabra "cert" en headers `X-Tags:` (header oficial Mailpit). El `SesService.sendViaSmtp` setea `X-Tag-cert: <certId>` pero NO `X-Tags: cert`. La query devuelve 0 resultados → tracker no sintetiza nunca eventos en dev. | Setear header `X-Tags: cert` en `SesService.sendViaSmtp` (Mailpit lo respeta como tag oficial), o cambiar la query a `headers:"X-Tag-cert"`. Falta integration test que verifique al menos un message returned. |
| A4-10 | `src/modules/email/bounce-alarm.service.ts:1-73` | Medium | Test-coverage | `BounceAlarmService` está provided + exported pero **nadie lo invoca** (`grep` sólo lo encuentra en `email.module.ts`). Comentario dice "EmailWorker puede llamar checkAndAlert después de cada send" — no implementado. Sin spec dedicado. | Wire en `EmailWorkerService.handleIssued` (best-effort, fire-and-forget tras sent), o cron `@Cron` Sprint 5. Agregar `bounce-alarm.service.spec.ts`. |
| A4-11 | `src/workers/pdf-worker.service.ts:48,80-95` | Medium | Performance | Polling sleep `setTimeout(POLL_INTERVAL_MS=3000)` entre `pollOnce`s, sin backoff exponencial en error ni jitter. `pollOnce` ya hace long-poll SQS (`WaitTimeSeconds:1`) pero cuando la cola está vacía la latencia mínima de un mensaje pendiente es ~3s + 1s = 4s. | Reducir `POLL_INTERVAL_MS` a 500ms o eliminarlo (long-poll de SQS ya throttlea). Aplicar igual a `EmailWorker`. |
| A4-12 | `src/workers/pdf-worker.service.ts:53` | Medium | Pattern | `TemplateResolver` instanciado directo (`new TemplateResolver()`) en el worker en lugar de DI provider. Misma cosa en `EmailWorkerService:38` con `EmailTemplateResolver`. Cache es per-worker-instance, OK; pero rompe convención NestJS y dificulta tests con instancia compartida. | Registrar resolvers como providers en `CertificatesModule` / `EmailModule` y inyectar. |
| A4-13 | `src/infra/aws/ses.service.ts:65-78` | Medium | Pattern | `SesService` instancia `SESClient` eagerly aún en modo `smtp` (constructor dice "backward-compat con specs Sprint 0"). Acopla legacy a runtime. | Lazy: instanciar el `SESClient` la primera vez que `transport==='aws'` realmente se usa. Refactorear el spec backward-compat. |
| A4-14 | `src/modules/webhooks/webhooks.service.ts:1-9` | Low | Maintainability | `WebhooksService.handleSes` sólo lanza `NotImplementedException`. El controller no la usa. Dead code. | Eliminar archivo o reemplazar por servicio real (mover lógica del controller). |
| A4-15 | `src/workers/pdf-worker.service.ts:236-271` | Low | Clarity | `template({ ... })` infla con datos formateados inline (`limitFormatted`, `copaymentFormatted`). Si se cambia el formato (locale es-MX), hay que tocar el worker, no la plantilla. | Extraer helpers Handlebars (`{{format-amount limit}}`) o un `format-cert.ts` reutilizable. |
| A4-16 | `src/modules/certificates/dto/certificate.dto.ts:5` | Low | Test-coverage | El enum status del schema (`['issued','reissued','revoked']`) no incluye un literal `'failed'` (consistente con A4-03 pero perpetúa el bug). | Si A4-03 se acepta, agregar `'failed'` al enum tras la migración. |
| A4-17 | `src/modules/certificates/certificates.service.ts:148,164,217` | Low | Maintainability | Magic number TTL 7d (`7 * 24 * 60 * 60`) repetido 3 veces en service + worker. | Constante `PRESIGNED_TTL_SECONDS = 7 * 24 * 60 * 60` exportada. |
| A4-18 | `src/modules/email/bounce-alarm.service.ts:12` | Low | Maintainability | Magic threshold `BOUNCE_RATE_THRESHOLD = 0.05`. Hardcoded; ningún tenant puede subir/bajar. | Mover a env var (`SES_BOUNCE_ALARM_THRESHOLD` default 0.05) o columna `tenant.thresholds.bounceRate`. |
| A4-19 | `src/modules/certificates/certificates.service.ts:201-203` | Low | Pattern | Cast `as unknown as Prisma.InsuredWhereInput` con comentario "depende de la migración Sprint 4". Si la columna `cognitoSub` ya existe en schema actual, el cast es ruido. | Verificar `Insured` model en `schema.prisma`; eliminar cast si la columna está. |
| A4-20 | `src/workers/pdf-worker.service.ts:387` | Low | Clarity | `void pdfHash;` al final — calculo de `pdfHash` en línea 316 se persiste solo en S3 metadata. La línea es para silenciar TS unused. | Documentar inline why o eliminar (S3 metadata se setea con `pdfHash`, ya basta). |
| A4-21 | XMP / firma cert | Medium | Security | No se observa código de firma XMP/PDF metadata (esperable para certificados oficiales). Hash en S3 metadata pero no hay XMP signing. | Sprint 5: evaluar `pdf-lib` / `node-signpdf` para firmar el PDF (PAdES) — el verify endpoint podría devolver "firmado por SegurAsist". |
| A4-22 | `puppeteer.service.ts:97-102` | Low | Bug latente | El timeout detection (`elapsed >= timeoutMs - 100`) es heurístico — si Puppeteer lanza error rápido por OTRA causa que dure ~timeoutMs, se reportará como timeout. | Usar `AbortController` o el flag de error que Puppeteer expone (`TimeoutError`). |
| A4-23 | `email-worker.service.ts:215` | Low | Clarity | `configurationSet: \`segurasist-${this.env.NODE_ENV}\`` hardcoded — en Mailpit no hace nada, en SES requiere que el set exista (Terraform provisioning). | Usar `env.SES_CONFIGURATION_SET` (ya existe en env.schema.ts:81). |

## Cross-cutting concerns (afectan a otras áreas)

Append al feed:

```
[A4] 2026-04-25 16:50 Critical src/workers/pdf-worker.service.ts:316,357 — `hash` persistido es provisionalHash random, no SHA-256 del PDF; rompe contrato de `CertificateIssuedEvent` // Afecta A5 (reports), A7 (admin UI cert detail), A10 (verify endpoint contract)
[A4] 2026-04-25 16:50 High src/infra/aws/ses.service.ts:154-155 — sendViaSes descarta tags/headers, X-Tag-cert no llega al webhook SES en prod // Afecta A6 (webhook recibirá eventos sin tagCert → ignorados silenciosamente), A9 (Terraform Configuration Set inútil sin tags)
[A4] 2026-04-25 16:50 High src/workers/pdf-worker.service.ts:282-294 — status 'failed' se persiste como 'revoked' (placeholder) // Afecta A5 (reportes mezclan revoke manual con fallos), A2 (enum CertificateStatus en Prisma necesita migración)
[A4] 2026-04-25 16:50 Medium src/workers/mailpit-tracker.service.ts:85 — query `tag:cert` no matchea X-Tag-cert headers; tracker dev nunca sintetiza eventos // Afecta A10 (DX dev), no impacta prod
[A4] 2026-04-25 16:50 High src/modules/webhooks/ses-webhook.controller.ts:67 — POST /v1/webhooks/ses público sin throttle // Afecta A6 (hardening throttler global)
```

Compatibilidad con A3:

- `InsuredCreatedEvent` shape (events/insured-events.ts) consumido por `PdfWorker.handleInsuredCreated` → coincide (`{kind,tenantId,insuredId,packageId,source,occurredAt}`). Sin issue.

## Recommendations Sprint 4 (top 5 acciones)

1. **A4-01 (Critical) — Fix hash contract**: o (a) re-render PDF en 2 pasadas (1ª para SHA, 2ª para QR con SHA real), o (b) cambiar contrato del evento + verify para usar `provisionalHash` consistentemente y persistir SHA-256 sólo como `pdfChecksum` separado. Documentar en ADR. Ajustar tests (`pdf-worker.spec.ts:234` valida `x-hash` SHA-256, pero el `hash` row es random).
2. **A4-02 (High) — Tags/Headers en SDK v3**: usar `Tags:[{Name:'cert',Value}]` en `SendEmailCommand`, o migrar a `SendRawEmailCommand` con MIME headers para `X-Trace-Id`. Test que valide el comando AWS recibe `Tags`. Sin esto, el webhook SES en prod queda inservible.
3. **A4-03/A4-16 (High) — Status `failed` first-class**: migración Prisma para añadir `failed` al enum `CertificateStatus`; refactor `pdf-worker:282-294` y DTO; migración rellenar histórico (`reason LIKE 'generation_failed:%'` → `status='failed'`).
4. **A4-04/A4-05 (High) — Hardening webhook SES**: throttle obligatorio + `sns-validator` real (firma criptográfica). Agregar test integration con SNS payload firmado mock.
5. **A4-09 + A4-10 (Medium) — DX dev tracker + alarm wireup**: arreglar query Mailpit (header `X-Tags`) para que el dev loop muestre delivered/opened; cablear `BounceAlarmService.checkAndAlert` desde `EmailWorker.handleIssued` (fire-and-forget) o como `@Cron` Sprint 5; agregar `bounce-alarm.service.spec.ts`.

Quick wins adicionales: extraer `PRESIGNED_TTL_SECONDS` constante (A4-17), eliminar `WebhooksService` dead code (A4-14), reemplazar instanciación directa de resolvers por DI (A4-12), mover threshold bounce a env var (A4-18).
