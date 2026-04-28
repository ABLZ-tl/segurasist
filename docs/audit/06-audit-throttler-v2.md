# Audit Report v2 — Audit log + Throttler + Hardening (A6, 2da vuelta)

## Summary (≤10 líneas)

Re-revisión cross-cutting del área A6 a la luz de los 68 findings agregados al
feed por las otras 9 áreas. Los hallazgos de la 1ra vuelta (A6-01..A6-14) se
mantienen vigentes; esta vuelta encuentra **8 patrones convergentes nuevos**
que ningún agente individual podía ver. Lo más grave: (1) la **infra de audit
está triplicada y desincronizada** — enum `AuditAction` overloaded por OTP
(A1) + scrub-keys duplicado (A6-01) + `{ip,userAgent,traceId}` extraído en
mano en 7 sitios (A5-40) — síntoma de que falta una clase única de
`AuditContext`; (2) la **integridad del sistema está rota en dos puntos
independientes** — A4-01 (hash PDF random en lugar de SHA-256) + A6-02
(verifier light path no recompute SHA) — cada uno por separado es High, juntos
borran toda confianza forense; (3) **CloudWatch alarmas inexistentes** (A9-03)
es el guante que aprieta al cuello — ni `BounceAlarmService` ni el chain
verifier ni el throttler tienen monitor en prod. Confirmamos también: el bug
de la cookie del portal (A8-01) está **emitiendo audit rows mal etiquetados**
(actor `admin_segurasist` en flujos del insured), `/v1/webhooks/ses` sigue
público sin throttle (A4-04) y los tests del throttler **no incluyen
combinación user+tenant en el cross-tenant suite**.

## a) Patrones convergentes (deep-dive)

### Patrón P1 — "Audit infra fragmentada" (A1 + A5-40 + A6-01/04 + tu A4)

Cinco síntomas distintos del mismo problema: **la información de un evento
audit hoy se compone en cinco lugares con cinco formatos**:

1. **Enum sobrecargado** (A1, prisma `AuditAction`): los valores
   `create|update|delete|read|login|logout|export|reissue` no cubren
   `view|download|otp_requested|otp_verified|tenant.override.used|export.requested`.
   Workaround actual: usar `action='login'` + discriminar por `resourceType`
   string libre (`auth.otp.requested`, `auth.otp.verified` —
   `auth.service.ts:233,318`). Lo mismo pasa en
   `insureds.service.ts:430,626` ("AuditAction no incluye 'view' explícito,
   codificamos en payloadDiff") y `certificates.service.ts:178`
   ("'download' no existe, codificamos en payloadDiff").
2. **Lista `SENSITIVE_KEYS` duplicada** (A6-01): copia byte-idéntica entre
   `audit.interceptor.ts:11-30` (depth=8) y `scrub-sensitive.ts:23-38`
   (depth=12) — drift inevitable cuando una agrega `sessionToken` y la otra
   no.
3. **`{ip, userAgent, traceId}` extraído manualmente** (A5-40): mismo patrón
   verbatim en `insureds.controller.ts:115-119` y `:173-177`,
   `certificates.controller.ts:79`, `insureds.service.ts:631-637` y
   probablemente más sitios cuando se cierre cobertura. Cada uno hace su
   propio cast `as string` sobre `req.headers['user-agent']`.
4. **`recordOverrideUse` separado de `record`** (auto-cross): `audit-writer
   .service.ts:248-264` crea wrapper específico que sólo difiere en defaults
   de payloadDiff. Multiplica métodos cada vez que aparece un nuevo evento
   especial (otp.requested, tenant.override.used, etc).
5. **`AuditEvent.action` ≠ `AuditAction` enum**: la interface TS de
   `AuditWriterService` (`audit-writer.service.ts:55`) declara unión de
   strings literales que `import` directo del enum de Prisma evitaría —
   cualquier rename del enum requiere edit manual del TS.

**Diseño propuesto (Sprint 4 / Sprint 5)** — single shape:

```ts
// src/modules/audit/audit-context.ts
@Injectable()
export class AuditContextFactory {
  fromRequest(req: FastifyRequest): AuditContext { /* ip, userAgent, traceId, actorId */ }
}

// src/modules/audit/audit-event.ts
export interface AuditEvent {
  action: AuditAction; // enum Prisma directo
  subAction?: string;  // opcional, free-form ('otp_requested', 'view', 'download') reemplaza el resourceType-as-discriminator
  resourceType: string;
  resourceId?: string;
  payloadDiff?: unknown;
  ctx: AuditContext;   // ip+userAgent+traceId+actorId AGRUPADO
}
```

Y migración:
- enum `AuditAction` extendido en migración Prisma para incluir `view`,
  `download`, `otp_requested`, `otp_verified`, `override_used`. Backfill via
  SQL UPDATE con map de `(action='login', resourceType='auth.otp.requested')
  → (action='otp_requested', subAction=null)`.
- `audit.interceptor.ts` consume `AuditContextFactory.fromRequest()` y elimina
  su `redact()` local (usa `scrubSensitiveDeep`).
- `recordOverrideUse` se elimina; `audit.record({ action: 'override_used',
  ... })` lo cubre con el mismo shape.

Este refactor cierra A1, A5-40 (parcial), A6-01, A6-04 simultáneamente.

### Patrón P2 — "Integridad doblemente rota" (A4-01 + A6-02)

Dos puntos críticos de integridad están comprometidos por separado:

- **A4-01** (`pdf-worker.service.ts:316,357`): el `hash` que se persiste en
  `certificates.hash` es `provisionalHash` (random/UUID), NO el SHA-256 del
  PDF. El contrato `CertificateIssuedEvent` declara hash criptográfico, los
  consumers (admin UI cert detail, `/verify` endpoint del frontend público,
  reports `getCertificatesByHash`) muestran ese hash como "garantía de no
  modificación" — pero es un nonce. Un atacante con upload directo a S3 puede
  reemplazar el PDF y la cadena de confianza no detecta nada.
- **A6-02** (`audit-chain-verifier.service.ts:140-153`):
  `recomputeChainOkFromDb` (path `source='both'`) sólo encadena `prev_hash`
  sin recomputar SHA-256. Tampering coordinado donde el atacante muta
  `payloadDiff` Y `rowHash` (consistente entre sí pero distinto del hash
  recomputado) **pasa** este check. Sólo el cross-check con S3 lo detecta —
  y el cross-check IGNORA filas con `mirroredToS3=false` (ventana eventual
  de 60s).

**Combinación fatal**: si un atacante con `BYPASSRLS` muta:
1. `certificates.hash` (A4-01: nadie lo verifica vs el PDF real).
2. `audit_log.payloadDiff` + `audit_log.rowHash` consistentes (A6-02: el
   light path no detecta el SHA mismatch).
3. Bonus: lo hace **dentro** de la ventana de 60s pre-mirror (A6 ventana
   eventual de S3 → la fila no entra al cross-check).

→ **Sin paper trail forense recuperable**. El claim de cumplimiento
  inmutable de la doc A8 (Seguridad/Cumplimiento) cae.

**Acción**: cerrar A4-01 (forzar SHA-256 real) y A6-02 (exportar
`runVerification` y reemplazar el light path) son **prerrequisitos del MVP**,
no del Sprint 5. La `tampering-resistance` claim del MVP necesita ambos.

### Patrón P3 — "CloudWatch alarmas: 4 servicios sin guardian" (A9-03)

DevOps confirmó (A9-03) que `segurasist-infra/modules/cloudwatch-alarm`
existe pero **nunca se instancia** en `envs/{dev,staging,prod}/main.tf`.
Esto deja silenciados:

| Servicio | Métrica que debería alarmar | Si falla → |
|---|---|---|
| `BounceAlarmService` (A4-cross) | `EmailBounceRate > 5%` | reputation SES, blacklist Hospital MAC. |
| `AuditWriterService` (A6-07) | Modo pino-only (BD ausente) | audit_log NO persiste; sólo CloudWatch. Si CW falla → cero rastro. |
| `AuditChainVerifierService` (A6-02) | `valid=false` o `discrepancies.length>0` | tampering detectado pero nadie escucha. |
| `ThrottlerGuard` Redis fail-open (A6 strength #4) | `THROTTLE_REDIS_FAILURE_RATE > 0` | API sirve sin rate limit; on-call no se entera. |
| Lambda audit-mirror | `errors > 0` o `lag > 120s` | mirror se atrasa; cross-check falla por filas no-mirroreadas (P2 vector). |

**Confirmación A6 cross-cutting → sí, lambda audit tampering trigger debe
alarmar**: el verifier debería correr cron 1×/hora (admin_segurasist) o
cron 1×/día (compliance) y publicar métrica EMF
`AuditChainValid (Tenant=foo, Source=both) = 1|0` + alarm
`AuditChainBroken > 0 in 1 datapoint`.

**Recomendación**: bloquear MVP-09 hasta que las 5 alarmas estén instanciadas
en Terraform (módulo ya existe) + 1 SNS topic `oncall-p1` + 1 dashboard
`segurasist-prod-dashboard` (10 widgets: 4xx/5xx, lag SQS x4, bounce rate,
verify-chain status, mirror lag, throttler block rate, audit writer mode).

### Patrón P4 — "23 it.todo + tests de tenant throttler ausentes" (A2-34 + A10-73)

Las 23 `it.todo` HTTP cross-tenant (A2 + A10) NO tocan el throttler. Mi
revisión de `throttler.guard.spec.ts` (unit) y `throttler.spec.ts`
(integration) confirma:

- ✅ unit tests cubren bucket user-IP solo + tenant solo + ambos en paralelo
  + ataque distribuido cross-IP single-tenant (línea 210).
- ❌ NINGÚN test verifica **throttler keying entre dos tenants distintos**:
  ¿el `t:tenant-A` cuenta independiente de `t:tenant-B` cuando ambos llegan
  al mismo endpoint? Está implícito en `buildTenantKey(tenantId, route)`
  (`throttler-redis.storage.ts`), pero no hay assert.
- ❌ Ningún `it.todo` en cross-tenant.spec lleva nombre tipo "throttler bucket
  is keyed per-tenant" — el suite no contempla rate limit como vector de
  cross-tenant (un tenant agotando el cupo del otro).

**Riesgo**: si un refactor cambia `buildTenantKey` y omite `tenantId`, todos
los tenants comparten el mismo bucket → tenant ruidoso bloquea a todos los
demás. Cero detección.

**Acción**: añadir `it('tenant-A 100 req no afecta el cupo de tenant-B',
async () => {...})` al `throttler.guard.spec.ts` y un E2E con dos JWTs de
tenants distintos.

## b) Correlaciones nuevas

### C1 — Webhooks `/v1/webhooks/*` sin throttle: ¿son sólo SES?

Grep `@Controller(...path: 'webhooks')` → **sólo `ses-webhook.controller.ts`**.
Confirmado: en MVP el único webhook es SES. Pero el patrón está plantado:
`@Public()` + `@Post('ses')` SIN `@Throttle`. Si Sprint 5 agrega Twilio SMS
DLR, Stripe, Calendly, etc., el copy-paste va a propagar el bug.

**Acción defensa-en-profundidad**: aplicar `@Throttle({ ttl: 60_000, limit:
600 })` en el controller class entero (`@Controller({ path: 'webhooks',
version: '1' }) @Throttle(...)`) — webhooks legítimos de AWS llegan en
ráfagas <600/min/IP. Más estricto: usar `extractIp` desde el SNS source
range (whitelist `sns.*.amazonaws.com` IPs) y rechazar fuera del rango.

Cross-link con A4-04: el fix de A4-05 (validar firma SNS) NO suplanta el
throttle — si el atacante encuentra una vuln en `aws-sns-validator`, el
throttle es la última línea.

### C2 — A8-01 portal proxy + AuditInterceptor: rows mal etiquetados

`apps/portal/app/api/proxy/[...path]/route.ts:2,13` importa
`SESSION_COOKIE` (admin `sa_session`) en lugar de
`PORTAL_SESSION_COOKIE` (`sa_session_portal`). Implicación cruzada **directa
para A6**:

- Si un admin tiene **ambas** sesiones activas (cookie del admin app + cookie
  del portal) en el mismo browser, el proxy del portal lee `sa_session`
  (admin) y reenvía `Authorization: Bearer <admin_token>` al backend.
- Backend valida JWT como `admin_segurasist`, ejecuta endpoints del portal
  (`/v1/insureds/me`, `/v1/coverages/me`, etc).
- `AuditInterceptor` registra `actorId = admin.id`, `tenantId = admin.tenant`
  (no el del insured), `resourceType = 'insureds'` con `payloadDiff` del
  flujo del insured.

→ **Filas en `audit_log` quedan etiquetadas como acción del admin sobre
recursos del portal**, distorsionando la vista 360 del tenant del insured y
los KPIs de "actividad del usuario portal" en reports.

**Acción**: además del fix A8-01 (cambiar a `PORTAL_SESSION_COOKIE`), añadir
constraint en backend: si JWT.role==='admin_segurasist|admin_mac' y la ruta
empieza con `/v1/*/me`, rechazar 403 — el admin no tiene `me` semántico en
endpoints del insured.

### C3 — A4-bounce-alarm-unwired ↔ A6 alarms-missing

`BounceAlarmService` (`bounce-alarm.service.ts`) está declarado en
`email.module.ts:12-13` (provider + export) pero su único método público
`checkAndAlert` **nunca es invocado** (grep retorna sólo la def y el doc-
comment). `EmailWorkerService` no lo llama, no hay cron, no hay endpoint.

Dado A9-03 (alarmas CloudWatch ausentes), tenemos **doble silencio sobre
bounce rate**:
1. La métrica EMF `EmailBounceRate` no se publica (no hay code-side trigger).
2. Aunque existiera, no habría alarma (no hay TF instance).

**Acción**: en Sprint 4, cablear `BounceAlarmService.checkAndAlert(tenantId)`
como cron (1×/hora) en `WorkersModule` + publicar metric EMF + instanciar
alarm CW + page on-call.

### C4 — `/v1/audit/log` (list) vs `/v1/audit/verify-chain`: ¿el primero también necesita throttle?

`audit.controller.ts:30` (`@Get('log')`) tiene `@Roles('admin_segurasist',
'admin_mac', 'supervisor')` pero ningún `@Throttle`/`@TenantThrottle`. El
default user-IP (60/min) aplica. Para tenants con 100k+ rows
(`reports-worker.service.ts` cliente típico), una query mal paginada
(`limit=10000`) puede DoS la BD. El cursor `audit-cursor.ts` mitiga, pero un
admin malicioso/comprometido puede iterar.

**Acción**: añadir `@TenantThrottle({ ttl: 60_000, limit: 30 })` al `list`
endpoint y validar que `query.limit ≤ 100` (hard cap server-side).

### C5 — Audit interceptor solo mutaciones; ¿HEAD/OPTIONS?

`AuditInterceptor:122` filtra `method !== 'GET' && method !== 'HEAD' &&
method !== 'OPTIONS'`. `TenantOverrideAuditInterceptor:40` filtra al
contrario (`isReadOnly = GET|HEAD|OPTIONS`). **HEAD y OPTIONS están
correctamente excluidos del audit log estándar** y **incluidos** en el
override-audit. Esto está bien para HEAD (read-side cacheable) pero
**OPTIONS es preflight CORS** — no es una operación real del usuario, no
debería emitir filas en `audit_log` ni siquiera para overrides.

**Acción menor**: en `tenant-override-audit.interceptor.ts:40`, cambiar
`method === 'GET' || method === 'HEAD'` (excluir OPTIONS). Reduce ~10x
filas espurias en el ledger cuando el browser hace preflight a cada PATCH.

## c) Re-leer código (verificación specific items)

### `audit-chain-verifier.service.ts:140-153` (light path Critical)

Confirmado el comment explícito: "Esta función es un check ligero ... sin
recompute SHA". El `runVerification` que sí recompute existe en
`audit-writer.service.ts:342` pero **NO está exportado** (función-módulo
privada). El fix A6-02 requiere:
1. Exportar `runVerification` desde `audit-writer.service.ts` (línea 381).
2. Reemplazar `recomputeChainOkFromDb` por `runVerification(rows.map(...))`
   en `audit-chain-verifier.service.ts:92`.

### `audit-writer.service.ts:110-117` health degraded

Correcto: `this.client = null` en pino-only mode. **No hay
`HealthIndicator` que exponga este estado**. `/health/ready` puede responder
200 con audit silenciado. En prod sin observabilidad (P3) esto pasa
inadvertido por días.

### `scrub-sensitive.ts` cutoff 12 vs interceptor lista 8 (drift)

Confirmado:
- `scrub-sensitive.ts:40` → `MAX_DEPTH = 12`.
- `audit.interceptor.ts:30` → `if (depth > 8)`.
- Listas de keys: literal-byte iguales, pero el interceptor usa `Set` y la
  utility usa `ReadonlySet` — semánticamente idénticas.

Drift hipotético: si alguien agrega `cognitoIdToken` en `scrub-sensitive.ts`
(canonical), olvida copiar al interceptor → el `payloadDiff` persistido en
BD lo deja pasar mientras pino lo redacta. **El log queda redactado pero el
audit_log queda con el secreto**.

### `throttler.guard.ts` doble bucket — tests cubren combinación user+tenant

Sí (`throttler.guard.spec.ts:165-186`), pero no cubren:
- `tenant-A` independiente de `tenant-B` (mismo route, different tenant).
- Edge: `req.tenant === undefined` con `@TenantThrottle` aplicado (debería
  ser no-op no error). Hay un assert implícito en `cae a IP cuando no hay
  user` pero específicamente para tenant ausente con `@TenantThrottle`
  declarado, no hay test.

### `tenant-override-audit.interceptor.ts:40` solo GET

Filtra `GET || HEAD || OPTIONS`. Ya cubrí en C5 que **OPTIONS no debería
emitir audit row** (es preflight CORS, no actividad del usuario). Cambio
puntual.

## d) Tests

### Tampering scenario coordinado (UPDATE row_hash + payloadDiff)

**Estado actual**: No existe.

`verify-chain-cross-source.spec.ts:242` (integration) muta sólo `rowHash`
(no `payloadDiff` simultáneo). El test detecta el mismatch porque S3 sigue
con el hash original — usa el cross-check, no el light path.

**El escenario que NO se está testeando**: actor con BYPASSRLS hace UPDATE
coordinado de **ambos** `row_hash` y `payloadDiff` de manera tal que
`computeRowHash(payloadDiff_new) === row_hash_new` (consistente entre sí),
PERO `row_hash_new !== sha256(payloadDiff_original)` (modificado vs el
original). En `source='both'`:
- Cross-check S3 detecta (S3 tiene el hash original).
- ✅ DESDE QUE EL ROW ESTÁ MIRROREADO. Si NO está mirroreado
  (`mirroredToS3=false`), el cross-check lo IGNORA (línea 67) y el light
  path `recomputeChainOkFromDb` también pasa (no recompute SHA).

**Test que falta** — `audit-chain-verifier.service.spec.ts` integration:
```ts
it('tampering coordinado payloadDiff+rowHash en fila pre-mirror NO se detecta (FUSE)', async () => {
  // Insertar 3 filas, ninguna mirroreada (mirroredToS3=false).
  // Mutar fila 2: payloadDiff='evil', rowHash=computeRowHash({...evil...}).
  // verify('both') retorna valid=true (FALSO POSITIVO de integridad).
  // Este test debería FALLAR y forzar el fix A6-02.
});
```

### `THROTTLE_LIMIT_DEFAULT=10000` en test enmascara regresiones

Confirmado (`app.module.ts:91`). Adicional: hay un riesgo concreto
**específico** que el comment del archivo no menciona — `it.todo`
(A2-34/A10-73) cuando se implementen, van a usar `request(server).post(url)`
sin sleep entre calls. Si un test llama `/v1/insureds` 50 veces y el límite
default fuera 60, una flake en CI tiraría 429 inesperado. Por eso pusieron
10000. Pero:

1. Cuando se cierre A2-34 (los 23 `it.todo`), si alguno **debe** verificar
   bloqueo (tipo "abusing /v1/audit/verify-chain DoS"), va a ser invisible.
2. Mejor approach: mantener default `60` en test, y los pocos suites que
   golpean repetido el mismo endpoint usan `@Throttle({...})` decorator de
   test que setea `limit: 10000` per-test (NestJS testing module override).

## Issues found (V2 únicamente — agregados a la tabla original)

| ID | File:line | Severity | Category | Description | Recommendation |
|---|---|---|---|---|---|
| A6V2-01 | `src/modules/audit/audit-writer.service.ts:55` + `auth.service.ts:233,318` + `insureds.service.ts:430,626` + `certificates.service.ts:178` | High | Schema/Maintainability | Enum `AuditAction` no cubre `view|download|otp_requested|otp_verified|override_used`; 5 sitios codifican el sub-action en `resourceType` o `payloadDiff` (drift garantizado, dashboards filtran por action y mezclan OTP con login real). | Migration: extender enum + backfill `(action='login', resourceType='auth.otp.requested') → action='otp_requested'`. Refactor `AuditEvent.action` a `import { AuditAction } from '@prisma/client'`. Cierra A1-overload con A6-01/04. |
| A6V2-02 | `src/common/interceptors/audit.interceptor.ts` + 3 controllers | Medium | DX/Maintainability | `{ip, userAgent, traceId}` extraído manualmente con cast `as string` en 3+ sitios (`insureds.controller.ts:115,173`, `certificates.controller.ts:79`, `insureds.service.ts:631`). Cada uno hace su propio fallback a `undefined`. | Crear `AuditContextFactory.fromRequest(req)` injectable; reemplazar todas las extractions. Documentar en `audit/CONTRIBUTING.md`. Cierra A5-40. |
| A6V2-03 | `src/modules/audit/audit-chain-verifier.service.ts:53-56,67` + `audit-writer.service.ts:381` | Critical | Test-coverage | El path tampering coordinado (UPDATE `payloadDiff` + `rowHash` consistentes en fila pre-mirror) NO está cubierto por ningún test. La combinación con A4-01 (PDF hash random) deja la cadena de integridad rota end-to-end sin alerta. | Exportar `runVerification` desde `audit-writer.service.ts`; reemplazar `recomputeChainOkFromDb`. Añadir test integration "tampering coordinado pre-mirror". |
| A6V2-04 | `segurasist-infra/envs/{dev,staging,prod}/main.tf` + 5 servicios | Critical | Observability | 5 vectores ciegos en prod por A9-03 confirmado: BounceAlarmService unwired (A4), AuditWriter pino-only mode (A6-07), ChainVerifier discrepancies (A6-02), ThrottlerGuard Redis fail-open (storage línea 79), Lambda mirror lag. Ninguno publica metric EMF ni dispara alarm CW. | Bloquear MVP-09 hasta instanciar 5 alarmas + SNS topic `oncall-p1` + dashboard. Cron 1×/hora del verify-chain con publicación EMF `AuditChainValid`. |
| A6V2-05 | `apps/portal/app/api/proxy/[...path]/route.ts:2,13` | High | Audit-data-quality | Bug A8-01 (cookie equivocada) → si admin tiene ambas cookies activas en mismo browser, `AuditInterceptor` etiqueta filas como acción del admin sobre recursos del insured (vista 360 distorsionada, KPIs portal incorrectos). | Fix A8-01 prereq + constraint backend: rechazar 403 si JWT.role.startsWith('admin_') y ruta es `/v1/*/me`. |
| A6V2-06 | `src/modules/webhooks/ses-webhook.controller.ts:61` | High | Security/DoS | Class-level missing `@Throttle`. A4-04 reportó el endpoint `ses` específico; en mi análisis el patrón class-level es sistémico — Sprint 5 va a copiar el `@Public + @Post` paradigm para Twilio/Stripe/Calendly. Sin guardrail class-level, el bug se va a propagar. | Aplicar `@Throttle({ttl:60_000, limit:600})` a nivel `@Controller({path:'webhooks'...})` (heredado por todos los handlers). Documentar pattern en `webhooks/CONTRIBUTING.md`. |
| A6V2-07 | `src/modules/email/bounce-alarm.service.ts:25` | High | Functional gap | `BounceAlarmService.checkAndAlert` declarado/exportado pero NUNCA invocado (grep confirma 0 callers). Combinado con A9-03 → bounce rate >5% pasa inadvertido en prod (reputation SES + Hospital MAC blacklist). | Cablear cron 1×/hora en `WorkersModule` + publicar metric EMF `EmailBounceRate{Tenant=foo}` + instanciar alarm. |
| A6V2-08 | `src/modules/audit/audit.controller.ts:30` | Medium | Security/Performance | `GET /v1/audit/log` sin `@TenantThrottle`. Tenant con 100k+ rows + admin malicioso/comprometido puede DoS-ear BD aunque el cursor lo limite per-page. | `@TenantThrottle({ttl:60_000, limit:30})` + hard cap server-side `query.limit ≤ 100`. |
| A6V2-09 | `src/common/interceptors/tenant-override-audit.interceptor.ts:40` | Low | Audit-data-quality | OPTIONS (preflight CORS) emite fila `tenant.override.used` cuando hay header `X-Tenant-Override`; multiplica filas por ~10× en prod (browser hace preflight para cada PATCH). | Cambiar `isReadOnly = GET || HEAD` (excluir OPTIONS). |
| A6V2-10 | `src/common/throttler/throttler.guard.spec.ts` + `test/security/cross-tenant.spec.ts` | Medium | Test-coverage | Tests del throttler verifican single-tenant (3 tests), pero NUNCA aseguran que `tenant-A` y `tenant-B` tengan buckets independientes. Si un refactor omite `tenantId` en `buildTenantKey`, todos los tenants comparten cupo → cross-tenant DoS sin detección. | Añadir `it('tenant-A 100 req no afecta cupo de tenant-B')` al unit spec; añadir 1 caso al `it.todo` de cross-tenant ("throttler bucket per-tenant"). |
| A6V2-11 | `src/app.module.ts:91` + futuros tests A2-34 | Medium | Test-strategy | `THROTTLE_LIMIT_DEFAULT=10_000` en test enmascara regresiones específicamente cuando se cierren los 23 `it.todo` (A2-34/A10-73) — algunos van a verificar bloqueo y serán silenciosos. | En lugar de default global=10000, mantener default=60 y override per-suite vía Nest testing module (`overrideProvider(THROTTLER_DEFAULT_TOKEN)`). |

## Cross-cutting (append al feed)

```
[A6V2] 2026-04-25 22:00 Critical AuditAction enum + scrub keys + audit ctx triplicados — patrón "audit infra fragmentada"; refactor a AuditContextFactory + enum extendido cierra A1+A5-40+A6-01+A6-04. // Impacta A1, A5.
[A6V2] 2026-04-25 22:00 Critical Integridad doblemente rota (A4-01 PDF hash + A6-02 chain light path) — claim cumplimiento inmutable cae en escenario coordinado pre-mirror. // Impacta A4 (prereq MVP).
[A6V2] 2026-04-25 22:00 Critical CloudWatch alarmas: 5 servicios sin guardian (BounceAlarm unwired + AuditWriter pino-only + ChainVerifier + ThrottlerRedis + LambdaMirror). // Confirma A9-03 + A4-bounce.
[A6V2] 2026-04-25 22:00 High Portal proxy cookie bug (A8-01) emite audit rows mal etiquetados — actor=admin, resource=insured/me. Distorsiona vista 360 + KPIs portal. // Impacta A8 (prereq fix), A5 (reports).
[A6V2] 2026-04-25 22:00 Medium Tests throttler no verifican aislamiento tenant-A vs tenant-B. // Impacta A2 (cross-tenant suite).
[A6V2] 2026-04-25 22:00 Medium @Throttle class-level ausente en /v1/webhooks/* — Sprint 5 va a propagar el bug a Twilio/Stripe. // Impacta A4-04.
[A6V2] 2026-04-25 22:00 Medium /v1/audit/log sin @TenantThrottle, admin malicioso puede DoS BD. Hard cap query.limit≤100 server-side. // Impacta A2.
[A6V2] 2026-04-25 22:00 Low OPTIONS preflight emite fila override-used espuria. // QoL.
```

## Recommendations Sprint 4 (priorizadas)

1. **(Critical, prereq MVP-09)** Cerrar A6V2-03 (export `runVerification` +
   reemplazar light path) **+** A4-01 (SHA-256 real del PDF). Sin ambos, el
   claim "audit immutable" del MVP no es defensible.
2. **(Critical, prereq MVP-09)** A6V2-04: instanciar 5 alarmas CloudWatch +
   SNS oncall + dashboard. Bloquear merge `main → prod` hasta que estén.
3. **(High, Sprint 4 cierre)** A6V2-01: refactor del enum `AuditAction` +
   `AuditContextFactory`. Migration con backfill. Cierra A1+A5-40+A6-01.
4. **(High, Sprint 4)** A6V2-07: cablear `BounceAlarmService` cron +
   métrica EMF.
5. **(High, prereq Sprint 5 portal)** A6V2-05 + A8-01: fix cookie portal +
   constraint backend `/v1/*/me`. Sin esto, los rows del audit_log de prod
   van a estar contaminados.
6. **(Medium, Sprint 4)** A6V2-06 (class-level throttle webhooks),
   A6V2-08 (audit/log throttle + hard cap), A6V2-10 (test tenant
   isolation), A6V2-11 (test throttler default).
7. **(Low)** A6V2-09 OPTIONS preflight noise.

## Notas

- El refactor P1 (`AuditContextFactory`) es la inversión de mayor ROI: cierra
  4 findings (A1, A5-40, A6-01, A6-04), elimina ~80 LOC duplicados, y
  habilita el cron del verifier con un shape consistente.
- El gap CloudWatch (A9-03 + A6V2-04) es el riesgo operacional más serio
  que tiene el sistema HOY — más que las vulnerabilidades código-side, porque
  cualquier vuln que se abra mañana no será detectada.
- `runVerification` debería renombrarse a `verifyChainRows(rows)` y
  exportarse como utility pure (no method de service) — el verifier puede
  consumirla sin acoplarse al `AuditWriterService`.
