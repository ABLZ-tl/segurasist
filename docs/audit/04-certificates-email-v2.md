# Audit Report v2 — Certificates + PDF + Email + SES (B4, 2da vuelta)

Re-revisión sobre `04-certificates-email.md` (1ra vuelta). Lectura del feed
completo (68 findings) + 6 reportes que mencionan A4 (A2/A3/A5/A6/A8/A9).
Confirmaciones, refutaciones, correlaciones nuevas, hallazgos puntuales que la
1ra vuelta no detectó.

---

## a) Patrones convergentes — confirmación cross-agente

### CONV-01 — Hash provisional NO es SHA-256 del PDF (A4-01) — CRITICAL CONFIRMADO + ÚNICO

- **1ra vuelta**: `pdf-worker.service.ts:316,357` persiste `provisionalHash`
  random en `certificates.hash`. El SHA-256 del PDF queda sólo en
  `S3.metadata.x-hash` (línea 330).
- **Convergencia**: A2 (`02-multitenant-rls.md`) y A5 (`05-insureds-reports.md`)
  asumen el contrato `Certificate.hash = SHA-256` (find360 lee `hash` directo);
  A6 (`06-audit-throttler.md`) no toca certs pero su hash chain SHA-256 está OK
  (audit-hash.ts:86 sí computa `createHash('sha256').update(canonical)`).
- **Investigación nueva**: ¿hay otros campos hash con el mismo bug?
  - `Export.hash` (`schema.prisma:603` doc "SHA-256 hex del archivo final"):
    revisado `reports-worker.service.ts:275` → `createHash('sha256').update(buffer).digest('hex')`. **CORRECTO**, usa el buffer real.
  - `AuditLog.rowHash`/`prevHash` (`schema.prisma:550-551`): `audit-hash.ts:86`
    canonical JSON + SHA-256. **CORRECTO**.
  - `Batch.hash`/`fileHash`: NO existe campo hash en model `Batch` (verificado).
  - El bug está **AISLADO en pdf-worker** — no es un patrón sistémico, es un
    bug local con un comentario que documenta el tradeoff (líneas 348-356)
    pero el comentario contradice el JSDoc del evento (`certificate-events.ts:21`).
- **Severidad**: confirmada Critical. Rompe el invariante público que el QR
  apunta al SHA del PDF (UX de verificación documentada al usuario final).

### CONV-02 — MessageDeduplicationId en colas standard (A4 implícito + A3-31 + A5-01 + A9-09) — HIGH SISTÉMICO

- **A4 (1ra vuelta)**: NO lo reportó como issue propio; pero `pdf-worker`
  envía `certificate.issued` y `certificate.generation_failed` a
  `SQS_QUEUE_EMAIL` SIN dedupeId (líneas 305, 380), mientras OTROS callers SÍ
  lo pasan a colas standard. Re-lectura confirma:
  - `pdf-worker.service.ts:305,380` → email-queue, **sin** dedupeId. Si el
    handler crashea antes del DELETE (línea 116-122), el visibility timeout
    re-enregar el mensaje y `EmailWorkerService.handleIssued` re-corre creando
    el segundo `email_events.event_type='sent'` (la dedupe DB-side existe sólo
    en `EmailWorkerService`? revisar). Email duplicado en la cola SES.
  - `certificates.service.ts:282` → `pdf-queue`, sin dedupeId (reissue).
  - `certificates.service.ts:319` → `email-queue`, sin dedupeId (resend).
- **Confirmación cross-agente**: A3 confirma en `insureds-creation-worker.ts:144`
  (`${createdInsuredId}:created`) y A5 en `insureds.service.ts:900`
  (`${exportId}`). 3 áreas (A3, A4 implícito, A5) y A9 confirma `pdf-queue`,
  `email-queue`, `reports-queue`, `layout-queue` son todas standard en
  Terraform (`envs/{env}/main.tf:364-369`).
- **Conclusión nueva (B4-V2-01)**: el bug es sistémico — todas las colas que
  usan `SqsService.sendMessage(...,dedupeId)` fallarán contra AWS SQS real con
  `InvalidParameterValue`. Pero **adicionalmente**, dentro de A4, **el caller
  de email-queue NO usa dedupeId** → emails de `certificate.issued` se pueden
  duplicar si Puppeteer responde tras un retry SQS. Es un drift inverso (debería
  pasarlo, no que existe sin pasarlo). Sprint 4 cierre conjunto: o (a) volver
  todas las colas FIFO + group-id, o (b) implementar idempotencia DB-side
  consistente en cada worker (PdfWorker ya tiene dedupe parcial vía UNIQUE
  `(tenantId, insuredId, version)`; EmailWorker no tiene dedupe sobre
  `email_events` por messageId).

### CONV-03 — SES SDK v3 descarta tags (A4-02) — HIGH CONFIRMADO + AGRAVADO

- **1ra vuelta**: `ses.service.ts:154-155` descarta headers/tags en `sendViaSes`.
- **Convergencia con A6**: A6-13 (`file-magic-bytes.ts`) y A6-03 (`verify-chain`
  hardening) no son del mismo bug, pero A9-05 confirma que NO hay job
  Trivy/build-image que detecte vulnerabilidades en el SDK. Cambio downstream
  silente.
- **Re-lectura código**: el spec `ses-adapter.spec.ts:62-78` (test "en prod
  usa AWS SDK SES") **NO valida que el SendEmailCommand reciba `Tags`**; sólo
  verifica que el send se llamó (`expect(sendMock).toHaveBeenCalledTimes(1)`).
  El bug es invisible al test. **B4-V2-02** (test gap): no existe test que
  verifique el comando AWS SES recibe `Tags:[{Name:'cert',Value:certId}]`.
- **Agravante encontrado nuevo (B4-V2-03)**: El header `X-Trace-Id` también se
  pierde en SDK v3 (la rama AWS no usa `SendRawEmailCommand`); en consecuencia,
  los `traceId` que `email-worker.service.ts:206` genera con `randomUUID()`
  se persisten en `email_events.detail.traceId` pero **NO viajan al evento SES**
  → cuando llegue el bounce/complaint vía webhook, NO hay forma de correlacionar
  con el log original más allá del `messageId` (el cual depende de cuál SES
  asigne). En prod, el operador debe hacer JOIN sobre `messageId` que es opaco
  vs el `traceId` que ya está en logs estructurados.
- **Bug en cascada con SES webhook (A4-04+05)**: aunque SE arreglase la firma
  SNS (Sprint 5), **mientras el SDK v3 no envíe Tags**, el webhook seguirá
  ignorando todos los eventos (`tagCert null` → línea 118 `return`). Es decir,
  fix de A4-04 es preliminar a A4-02; sin A4-02, el webhook es inútil.

### CONV-04 — SES Webhook hardening (A4-04, A4-05) + A6 confirma DoS pattern

- **A4-04**: SigningCertURL regex-only, sin verificación criptográfica.
- **A4-05**: POST público sin throttle.
- **A6 (06-audit-throttler.md)** confirma A4-05 explícitamente y propone
  `@Throttle({ttl:60_000,limit:120})` (consistente con la 1ra vuelta).
- **Investigación nueva (¿otros webhooks comparten el patrón?)**: revisado
  `src/modules/webhooks/` — sólo existe `ses-webhook.controller.ts`. No hay
  webhook EventBridge ni S3 notifications montados. El patrón de "webhook
  público sin firma criptográfica" está aislado a ese único endpoint. **No es
  sistémico**, pero la severidad es la misma.
- **B4-V2-04 nuevo**: `webhooks.service.ts:1-9` declara `WebhooksService.handleSes`
  que solo lanza `NotImplementedException`; el controller NO la usa. Es el mismo
  hallazgo A4-14 (Low Maintainability) pero ahora con peor olor: si Sprint 5
  alguien cree que esa función es donde implementar la firma SNS, agregará
  código en una clase que el controller ignora. Recomendación: borrar archivo.

---

## b) Correlaciones nuevas (cross-cutting)

### CORR-01 — A8-03 CSP frame-src ↔ A4-01 hash bug

- **A8** reporta CSP del portal NO declara `frame-src`; iframe del cert
  preview (S3 pre-signed `*.amazonaws.com`) será bloqueado en prod por
  fallback a `default-src 'self'`.
- **Implicación cruzada con A4-01**: si **NADIE** puede ver el preview del
  PDF en prod, la discrepancia entre `Certificate.hash` (random) vs
  `S3.metadata.x-hash` (real SHA) **JAMÁS sería detectada por un usuario final**.
  El bug del hash queda silente porque el UX no entrega el PDF para que
  alguien recompute. Esto agrava A4-01 — un bug funcional + un bug de UX se
  enmascaran mutuamente.
- **Implicación adicional**: el endpoint público `/v1/certificates/verify/{hash}`
  acepta el `provisionalHash`, pero si un tercero (oficina hospital, autoridad)
  recibe el PDF descargado por otro canal (email impreso) y recomputa el SHA
  para verificar contra `verify/{hash}`, **no encontrará match** (404). Es
  decir, la verificación pública por QR/hash **falla en el caso de uso primario
  declarado en docs MVP**. Confirmar: el QR apunta a `provisionalHash` (línea
  269 `qrCodeDataUrl: qr.dataUrl` con `qr.payload` construido sobre
  `provisionalHash`) → el QR sí matchea la BD; pero alguien que recompute SHA
  del PDF descargado obtendrá un valor distinto al de la BD. Severidad
  reconfirmada: **Critical** + caso de uso roto.
- **Mitigación corto plazo**: documentar en `docs/audit/INTERIM_RISKS.md` o
  ADR. Solución larga: re-render con SHA real en el QR (2-pass).

### CORR-02 — `verify-chain` (A6) vs `/v1/certificates/verify/{hash}` (A4) — endpoints distintos, ambos críticos

- **A6-03**: `GET /v1/audit/verify-chain` SIN throttle, full table scan +
  ListObjectsV2 + GetObject NDJSON parsing → DoS al cluster con creds super
  comprometidas. **Distinto endpoint** del verify de A4.
- **A4 verify endpoint**: `GET /v1/certificates/verify/:hash` SÍ tiene
  `@Throttle({ttl:60_000,limit:60})` (línea 37 controller). Lookup por
  índice (`certificates.hash`) — no hay riesgo DoS análogo.
- **Conclusión**: ambos endpoints públicos comparten el sufijo `verify` pero
  son completamente distintos en superficie de ataque. **Recomendación
  documental** (B4-V2-05): renombrar el de audit a `verify-chain-integrity` o
  similar para evitar confusión cross-tenant en logs y UI admin.

### CORR-03 — A2 `policies.sql` ↔ certificates table

- **A2-01** reporta `exports` falta del array tenant-iso de `policies.sql`.
- **Re-lectura nueva**: `certificates` SÍ está en `policies.sql:55`. Las
  policies tenant-iso para certificates están correctas (drop+recreate
  idempotente). **No hay drift en certificates**. La preocupación es que el
  pattern de "olvidar añadir tabla nueva al array" se reproduzca cuando se
  agreguen tablas auxiliares para certificates (e.g. `certificate_signatures`,
  `certificate_revocation_log` futuro). Cross-cut con A2-08 (descubrimiento
  dinámico).
- **B4-V2-06 nuevo**: `email_events` SÍ está en `policies.sql:60`, OK. No hay
  drift en A4 hoy.

### CORR-04 — A5-02 cast obsoleto en `urlForSelf`

- **A5-02** reporta `cognitoSub` cast `as unknown as Prisma.InsuredWhereInput`
  obsoleto post-migración `20260427_add_insured_cognito_sub`.
- **Re-lectura A4**: `certificates.service.ts:202` tiene exactamente el mismo
  cast (idéntica línea con comentario "depende de la migración Sprint 4").
  Ya estaba reportado como **A4-19** en la 1ra vuelta. Confirma que el cast
  se replica en 2 sitios A5 + 1 A4. Cross-cut con limpieza única.
- **B4-V2-07**: agregar a la lista de quick wins de Sprint 4 con fix conjunto
  (3 sitios: `certificates.service.ts:202`, `insureds.service.ts:673`,
  `claims.service.ts:82`).

### CORR-05 — A9-04 missing insureds-creation queue NO afecta directamente A4

- **A9-04** reporta cola `insureds-creation` no en Terraform (worker la fabrica
  con string-replace).
- **Implicación A4**: el `insureds-creation-worker` emite `insured.created` a
  `SQS_QUEUE_PDF` (queue OK, está en Terraform). El bug A9-04 NO bloquea el
  pipeline cert. **No hay correlación directa**.

### CORR-06 — A9 Mailpit en LocalStack (devops)

- A9 NO mencionó explícitamente Mailpit (buscado en feed). El bootstrap
  (`localstack-bootstrap.sh`) crea las colas SQS pero Mailpit corre como
  servicio Docker separado (puerto 8025/1025), NO dentro de LocalStack.
- **Re-lectura A4-09**: `mailpit-tracker.service.ts:85` usa query
  `tag%3Acert` (URL-encoded `tag:cert`). Bug confirmado: el `SesService.sendViaSmtp`
  setea `X-Tag-cert: <certId>` pero no `X-Tags: cert` (header oficial Mailpit).
  La query Mailpit busca substring en headers `X-Tags:` → 0 resultados.
- **Confirmación nueva (B4-V2-08)**: `extractCertId` en
  `mailpit-tracker.service.ts:144` SÍ lee `X-Tag-cert` correctamente del
  detail; pero **nunca llega al detail** porque la query inicial filtra a 0
  mensajes en `pollOnce:85`. La función auxiliar funciona pero el upstream la
  alimenta con array vacío. Bug encadenado: arreglar la query (`headers:"X-Tag-cert"`
  o setear `X-Tags: cert` en SesService) y `extractCertId` ya funciona.

---

## c) Re-lectura de código — refinamientos sobre 1ra vuelta

### REF-01 — `pdf-worker.service.ts:316,357` (A4-01)

- Confirmado bug + comentario contradice JSDoc.
- **Detalle nuevo (B4-V2-09)**: línea 389 `void pdfHash;` declara explícitamente
  el calculate-and-discard. El SHA real se calcula, se sube a S3 metadata, pero
  NUNCA se persiste en BD ni se emite en el evento. Si Sprint 5 quiere
  recomputar para "auto-verify": tendrá que hacer S3 HeadObject por cert para
  leer `x-hash`. Latencia y costo extra evitable.
- **Test gap** (B4-V2-10): `pdf-worker.spec.ts:264` valida `data.hash` matchea
  `/^[a-f0-9]{64}$/` — regex pasa con AMBOS hashes (provisional y real). El
  test NO recomputa SHA del buffer Puppeteer mockeado. Recomendación: agregar
  test "SHA-256 del buffer === certificates.hash persistido" que **falla hoy**
  y se vuelva passing tras el fix.

### REF-02 — `ses.service.ts:154-155` (A4-02)

- Confirmado descarta tags. Comentario reconoce "MVP envía por SendEmailCommand
  y dejamos los headers para el upgrade Sprint 5".
- **Detalle nuevo (B4-V2-11)**: SDK v3 `SendEmailCommand` SÍ acepta `Tags` en
  el input (`Tags: [{Name: 'cert', Value: certId}]`) sin necesidad de
  `SendRawEmailCommand`. El comment es **incorrecto técnicamente**. El fix es
  trivial: pasar `Tags: Object.entries(opts.tags).map(([k,v])=>({Name:k,Value:v}))`
  al `SendEmailCommand` constructor. Las **headers custom** sí requieren
  `SendRawEmailCommand` (MIME), pero los tags no.
- **B4-V2-12**: el `headers` propiamente dicho (`X-Trace-Id`, etc.) sí requeriría
  `SendRawEmailCommand` o usar `Tags` como vehículo (Tags = key/value, ASCII
  only). Recomendación pragmática: serializar `traceId` como `Tag` también.

### REF-03 — `ses-webhook.controller.ts` (A4-04, A4-05)

- Confirmado regex-only de SigningCertURL. Re-lectura encuentra:
- **B4-V2-13 nuevo**: línea 87 `if (body.Type === 'SubscriptionConfirmation')`
  hace `await fetch(body.SubscribeURL)` SIN validar primero el `SigningCertURL`.
  En prod, la validación regex (línea 76-85) corre antes. PERO en
  `process.env.NODE_ENV !== 'production'` (e.g. staging si `NODE_ENV=staging`),
  el bloque entero se salta y un atacante puede forzar al servicio a hacer
  GET a un `SubscribeURL` arbitrario (SSRF leve, no devuelve body al cliente,
  sólo 200 sin info). Severidad **Medium** (SSRF blind, no exfiltration).
  Recomendación: validar `SubscribeURL` también con regex `^https://sns\..*\.amazonaws\.com/` antes del fetch en TODOS los environments.
- **B4-V2-14 nuevo**: `await fetch(body.SubscribeURL)` SIN timeout. Mismo
  problema que A8-08 (portal-logout) — bloquea hasta DNS/TCP timeout (~30s
  default). Si un atacante envía 100 SubscriptionConfirmation con
  `SubscribeURL=http://10.0.0.0:81` (RFC 5737 / privado lento), satura el
  pool de fetch. Recomendación: `AbortController` con 5s timeout.

### REF-04 — `mailpit-tracker.service.ts:85` (A4-09)

- Confirmado bug query `tag:cert` sin matcheo.
- **Detalle nuevo (B4-V2-15)**: el `redis.set(seenKey, ..., SEEN_TTL_SECONDS)`
  línea 112 ocurre INCLUSO si `extractCertId(msg)` devolvió null (línea
  107-111 sólo persiste el evento; el SET de seenKey está fuera del `if`).
  Esto significa que un mensaje con cert tag malformado se marca como "seen"
  permanentemente y nunca reintenta. Si Sprint 4 arregla el query y el header
  `X-Tag-cert`, los mensajes ya marcados no re-emitirán `delivered`.
  Recomendación: invalidar caché Redis al desplegar fix.

### REF-05 — `certificates.service.ts` urlForSelf

- 1ra vuelta no encontró bugs en `urlForSelf`.
- **Re-lectura, hallazgo nuevo (B4-V2-16)**: línea 209 hace `findFirst` por
  `insuredId: insured.id, deletedAt: null` SIN filtrar por `status`. Si el
  insured tuvo un cert `status='revoked'` (placeholder de fallo, ver A4-03)
  como ÚLTIMO cert, `urlForSelf` devuelve la URL de un cert con `s3Key=''`
  (línea 287 del worker). El `getPresignedGetUrl` con `''` genera una URL
  malformada → cliente recibe 403/404 al abrirla. Severidad: **Medium** —
  affects portal users cuando Puppeteer falló en el último cert.
  Recomendación: filtrar `status: 'issued'` en línea 209-212, o `status: { in: ['issued','reissued'] }`.

### REF-06 — `certificates.service.ts` verify endpoint

- 1ra vuelta marcó "bien hardenado". Confirmo. Detalle nuevo:
- **B4-V2-17**: línea 367-368 filtra `status: 'issued'` correctamente — un cert
  re-emitido (`status: 'reissued'`) **NO se devuelve**. Esto es correcto
  funcionalmente (el cert vigente es siempre el `issued` actual), pero un
  tercero que escanee el QR de un PDF físico viejo (impreso antes de la
  re-emisión) verá `valid:false`. La UX recomendaría `valid: false, reason:
  'reemitted', currentVersion: N` para distinguir "expired" de "revoked" de
  "reissued" — hoy todo se mete en un único `valid: false`. **No es bug**,
  es UX gap. Severidad: **Low**.

---

## d) Tests — gaps específicos a A4

| ID | Gap | Severidad |
|---|---|---|
| B4-V2-T01 | `pdf-worker.spec.ts:237-267` — no recomputa SHA del buffer Puppeteer; el bug A4-01 es invisible. | High |
| B4-V2-T02 | NO existe test del webhook SES (`ses-webhook.controller.ts`); SubscriptionConfirmation, Notification con tag, Notification sin tag, Bounce hard → email NULL — todo sin cobertura. | High |
| B4-V2-T03 | `ses-adapter.spec.ts:62-78` — test "en prod usa AWS SDK SES" no verifica `Tags` en el input del SendEmailCommand; el bug A4-02 es invisible al test. | High |
| B4-V2-T04 | NO existe spec para `BounceAlarmService` (A4-10). | Medium |
| B4-V2-T05 | `cert-email-flow.spec.ts` está skip-eado salvo `CERT_EMAIL_FLOW_E2E === '1'`; CI NO setea esa env (A10-08 ya documenta el naming inconsistente). En consecuencia el ÚNICO test integration A4 nunca corre en CI. | High |
| B4-V2-T06 | `mailpit-tracker.service.ts` — sin spec dedicado; bug query `tag:cert` no detectable hasta que un dev manualmente vea Mailpit y note 0 eventos. | Medium |
| B4-V2-T07 | `urlForSelf` — sin test que cubra "último cert es status=revoked" → genera URL malformada (B4-V2-16). | Medium |
| B4-V2-T08 | NO hay test que reproduce el ciclo `provisionalHash en BD` vs `pdfHash en S3 metadata`. Sería el test que valida el fix de A4-01. | High (tras fix) |

---

## Reconciliación con 1ra vuelta

| ID 1ra vuelta | Status v2 | Notas |
|---|---|---|
| A4-01 (Critical hash) | **CONFIRMADO + AGRAVADO** | CORR-01 (CSP iframe roto enmascara), B4-V2-09 (calculate-and-discard antipattern), B4-V2-T01 + T08 tests gap. |
| A4-02 (High SES tags) | **CONFIRMADO + AGRAVADO** | B4-V2-11 (comment técnicamente incorrecto: SDK v3 SÍ soporta Tags directo), B4-V2-T03 test gap. |
| A4-03 (High status failed→revoked) | **CONFIRMADO + AGRAVADO** | B4-V2-16 (urlForSelf devuelve URL malformada cuando último cert es failed-as-revoked). |
| A4-04 (High webhook firma) | **CONFIRMADO + EXPANDIDO** | B4-V2-13 (SSRF blind en non-prod), B4-V2-14 (sin timeout en SubscribeURL fetch). |
| A4-05 (High webhook throttle) | **CONFIRMADO** | A6 también lo confirma. Sin cambio de severidad. |
| A4-06 (Medium SQS swallow) | Confirmado, sin updates. |
| A4-07 (Medium MAC hardcoded) | Confirmado, sin updates. |
| A4-08 (Medium OTP MAC hardcoded) | Confirmado, sin updates. |
| A4-09 (Medium mailpit query) | **CONFIRMADO + EXPANDIDO** | B4-V2-15 (Redis seenKey marca aunque certId null → invalidación necesaria al deploy fix), B4-V2-08. |
| A4-10 (Medium bounce alarm dead) | Confirmado, B4-V2-T04. |
| A4-11 (Medium polling jitter) | Confirmado, sin updates. |
| A4-12 (Medium DI resolvers) | Confirmado, sin updates. |
| A4-13 (Medium SES eager) | Confirmado, sin updates. |
| A4-14 (Low webhooks.service dead) | **CONFIRMADO + AGRAVADO** | B4-V2-04 — riesgo nuevo: dev de Sprint 5 podría implementar firma SNS en archivo dead. |
| A4-15-22 | Confirmados, sin cambios. |
| A4-19 (Low cast obsoleto) | **CROSS-CUT con A5-02 confirmado** | Fix conjunto 3 sitios. |

### Findings nuevos (no estaban en 1ra vuelta)

| ID | File:line | Severity | Category | Descripción |
|---|---|---|---|---|
| B4-V2-01 | `pdf-worker.service.ts:305,380` + `certificates.service.ts:282,319` | High | Pattern / Idempotencia | Callers a `SqsService.sendMessage` que NO pasan `dedupeId` para email/pdf-queue → en retry SQS, posibilidad de doble emisión email/PDF. Asimétrico vs otros workers que sí pasan dedupeId (que de todos modos se ignora en standard queue). Decisión arquitectónica conjunta con A3/A5/A9. |
| B4-V2-03 | `ses.service.ts` (rama AWS) | Medium | Observability | `X-Trace-Id` no se propaga al SES SendEmailCommand (sin Tags ni RawEmail). Imposible correlacionar bounce/complaint webhook con request original más allá de messageId opaco. |
| B4-V2-04 | `webhooks.service.ts:1-9` | Medium | Maintainability / Security future | Archivo dead que un dev Sprint 5 podría llenar con firma SNS pensando que el controller la usa. Eliminar. |
| B4-V2-05 | `audit.controller.ts:63` vs `certificates.controller.ts:35` | Low | Clarity | Nombre `verify-chain` vs `verify/:hash` confunde dashboards y logs. Renombrar audit a `audit-chain-integrity` o similar. |
| B4-V2-09 | `pdf-worker.service.ts:316,389` | Critical (parte de A4-01) | Anti-pattern | `pdfHash = createHash(...).digest()` y luego `void pdfHash;` — calculate-and-discard. El SHA real existe pero NUNCA se persiste en BD ni se emite. |
| B4-V2-11 | `ses.service.ts:150-155` | High (parte de A4-02) | Bug / Comment | El comment dice "SDK v3 SendEmailCommand NO soporta headers custom directamente" pero **Tags SÍ son soportados directamente** sin `SendRawEmailCommand`. Comment técnicamente incorrecto. |
| B4-V2-13 | `ses-webhook.controller.ts:87-97` | Medium | Security | SSRF blind: `await fetch(body.SubscribeURL)` sin validar URL en non-prod. |
| B4-V2-14 | `ses-webhook.controller.ts:91` | Medium | Pattern | `await fetch(body.SubscribeURL)` sin AbortController/timeout — puede colgar 30s. |
| B4-V2-15 | `mailpit-tracker.service.ts:112-113` | Low | Bug | Redis seenKey marca el mensaje aunque `extractCertId` devolvió null → bloquea reintento permanente. Invalidar caché al deploy del fix A4-09. |
| B4-V2-16 | `certificates.service.ts:209-212` | Medium | Bug | `urlForSelf` no filtra `status='issued'`; si el último cert del insured es un placeholder de fallo (`status='revoked'` con `s3Key=''`), genera URL malformada. Crash UX en el portal (CORR-01 lo enmascara temporalmente porque iframe ya estaba roto). |
| B4-V2-17 | `certificates.service.ts:368` | Low | UX / Contract | Verify endpoint devuelve `valid:false` indistinto para revoked/reissued/expired/not-found. UX gap para terceros validando un PDF físico viejo. |

---

## Cross-cutting concerns añadidos al feed (delta v2)

```
[A4-V2] 2026-04-25 23:00 High pdf-worker.service.ts:305,380 — callers email/pdf-queue NO pasan dedupeId; potencial doble emisión email/cert en retry SQS. // Cross-cut con A3-31, A5-01, A9-09 — la decisión FIFO vs idempotencia DB-side debe cubrir TODAS las colas y TODOS los callers (no sólo los que ya pasan dedupeId).
[A4-V2] 2026-04-25 23:00 Medium certificates.service.ts:209-212 — urlForSelf no filtra status='issued'; si último cert es failed-as-revoked, devuelve URL S3 malformada. // Bug latente que A8-03 (CSP iframe roto) enmascara temporalmente.
[A4-V2] 2026-04-25 23:00 Medium ses-webhook.controller.ts:87-97 — SubscriptionConfirmation fetch sin validación URL en non-prod (SSRF blind) ni timeout. // A6 (hardening webhook).
[A4-V2] 2026-04-25 23:00 Critical [confirmación CORR-01] hash bug A4-01 + iframe CSP A8-03 se enmascaran mutuamente — el caso de uso "tercero verifica QR" está roto end-to-end. Severidad agregada: el QR funciona (lookup BD) pero el SHA recomputado del PDF descargado NO matchea Certificate.hash → la verificación pública declarada falla.
```

---

## Recommendations Sprint 4 — Top 5 (revisado v2)

1. **A4-01 (Critical) Fix hash + cubrir con test que falla hoy** (B4-V2-T01,
   B4-V2-T08): refactor `pdf-worker.service.ts` a 2-pass render
   (1) calcular SHA del primer PDF, (2) re-render con QR apuntando al SHA real, persistir SHA real en `Certificate.hash` y emitir en evento. Test
   "buffer→SHA===Certificate.hash" que falla pre-fix.

2. **A4-02 (High) Tags en SES SDK v3 + test** (B4-V2-11, B4-V2-T03): pasar
   `Tags:[{Name,Value}]` directamente al `SendEmailCommand` (NO requiere
   RawEmail). Test que verifica el comando AWS recibe el array. Sin esto,
   webhook SES queda inservible aunque se arregle la firma SNS (A4-04).

3. **A4-04+05 (High) Hardening webhook SES + B4-V2-13/14** (SSRF + timeout):
   throttle obligatorio, `aws-sns-validator` real, validar `SubscribeURL` en
   TODOS los envs, AbortController 5s. Crear `ses-webhook.controller.spec.ts`
   con SubscriptionConfirmation real (B4-V2-T02).

4. **B4-V2-01 (High) Idempotencia consistente** (cross-cut A3/A5/A9):
   decisión arquitectónica única para TODAS las colas — o FIFO + group-id, o
   DB-side dedupe en cada worker. NO mantener un mix.

5. **A4-09 + A4-10 + B4-V2-15** (Medium DX dev tracker + alarm wireup):
   arreglar query Mailpit (`headers:"X-Tag-cert"`), invalidar Redis seenKey
   al deploy, cablear `BounceAlarmService.checkAndAlert`, agregar specs
   (B4-V2-T04, B4-V2-T06).

Quick wins extras:
- **B4-V2-04**: borrar `webhooks.service.ts` dead.
- **A4-19 + A5-02 cleanup conjunto**: 3 sitios `as unknown as Prisma.InsuredWhereInput`.
- **B4-V2-16**: filtrar `status='issued'` en `urlForSelf`.
- **B4-V2-05**: renombrar audit verify-chain endpoint para no confundir con cert verify.

---

## Resumen ejecutivo

- **Findings nuevos v2**: 11 (1 Critical refinement, 1 High, 2 Medium-bugs nuevos, 2 Medium webhook hardening, 5 Low/clarity).
- **Test gaps nuevos**: 8 (3 High prioridad).
- **Confirmaciones cross-agente**: A4-01 isolated (no es patrón sistémico), A4-02 confirmado + agravado por test gap, A4-04/05 isolated (único webhook), MessageDeduplicationId sí es patrón sistémico (A3+A4+A5+A9).
- **Refutaciones**: ninguna del 1ra vuelta. Todos los issues A4-01..A4-23
  permanecen válidos.
- **Mayor descubrimiento de la 2da vuelta**: CORR-01 — el bug A4-01 (hash) y
  A8-03 (CSP frame-src) se enmascaran mutuamente, dejando el caso de uso
  "tercero verifica PDF" completamente roto sin que ningún test lo capture.
