# Audit Report — A5 Insureds + Coverages + Packages + Reports (v2 — segunda vuelta)

## Contexto

Re-revisión de `05-insureds-reports.md` con feedback cruzado del feed
compartido `_findings-feed.md` (entradas A1, A2, A3, A4, A6, A8, A10) y
re-lectura de los archivos productivos del scope. Esta vuelta confirma /
amplía 4 patrones convergentes y agrega 7 findings nuevos (B5-NN) que
no aparecieron en la primera pasada.

## a) Patrones convergentes — confirmación

### A5-06 `buildInsuredsWhere` triplicado — CONFIRMED y peor de lo que parecía

Re-grep `fullName.*contains | curp.*contains | metadata.path.*numeroEmpleadoExterno`
arroja exactamente **3 sites** con la misma firma:

- `insureds.service.ts:288-298` (path `list`, 4-element OR).
- `insureds.service.ts:999-1004` (`buildExportWhere`, 4-element OR — IDÉNTICO).
- `workers/reports-worker.service.ts:312-317` (worker bypass, 4-element OR — IDÉNTICO).

**Drift hoy**: las 3 copias son byte-para-byte iguales en este momento; el
constructor del filtro arma `OR=[fullName, curp, rfc, metadata.numeroEmpleadoExterno]`
con el mismo orden. El test `insureds.service.spec.ts:66-81` valida `or[0]`
(fullName) y `or[3]` (metadata) específicamente — si alguien rota el orden,
sólo rompe el test del `list`, **no detecta la divergencia worker↔service**.

**Impacto sobre el "C bug fix" de Sprint 4**: si el ticket C corrige (p.ej.)
añadir `entidad` como filtro nuevo, sólo va a tocar UN lugar (típicamente
`list`). El export pipeline (`buildExportWhere`) y el worker (`queryInsureds`)
quedarían fuera de sync — **el listado del FE mostraría más/menos filas que
el XLSX/PDF descargado**. La discrepancia es invisible hasta que un cliente
notifique. El issue es **High** ahora (no Medium como lo registré v1).

### A5-01 `MessageDeduplicationId` enviado a cola estándar — CONFIRMED como issue sistémico

3er agente reportando (después de A3-31 y A5-01 v1). Verificado:

- `sqs.service.ts:26` adjunta `MessageDeduplicationId` si se pasa.
- `insureds.service.ts:900` lo pasa (con `exportId`).
- `batches.service.ts:443` lo pasa (con `${batchId}:completed`).
- `localstack-bootstrap.sh:138-143` crea TODAS las colas como standard
  (sin `--attributes FifoQueue=true`); ZERO referencias a `*.fifo` en repo.
- `.env.example:55` `SQS_QUEUE_REPORTS=...reports-queue` (sin `.fifo`).
- `sqs.service.spec.ts:28-35` testea `'incluye MessageDeduplicationId si se
  pasa (FIFO queues)'` — el comment dice FIFO pero en runtime envía a colas
  standard. **El test confirma el bug en lugar de detectarlo.**

Es un issue **sistémico de toda la capa SQS** (no exclusivo de A5). Recomendación
re-elevada: cualquiera de las 2 alternativas requiere coordinación A3+A5+A9.

### A5-03 `ExportRateLimitGuard` sin tests — CONFIRMED gap

`find` en `test/`, `src/modules/insureds/`: **0 archivos** que matcheen
`*export-rate-limit*`. El guard tiene 88 líneas con 5 caminos distintos
(http-only short-circuit, kill switch, sin tenant, bypass disabled, cap
excedido) — **0 tests dedicados**. Cubierto indirectamente sólo por
`test/integration/insureds-export.spec.ts` que NO ejercita el guard
explícitamente (mockea Prisma directamente sin pasar por el `canActivate`).

### `cognitoSub as unknown as Prisma.InsuredWhereInput` cast obsoleto — CONFIRMED + EXPANDED

A2-03 reporta drift `@unique` (schema) vs partial UNIQUE index (migración).
Re-grep del cast `as unknown` en módulos del scope encuentra **3 ocurrencias
del cast obsoleto** (no 2 como reportaba v1):

1. `insureds.service.ts:673` — `findSelf`.
2. `claims.service.ts:82` — `createForSelf`.
3. **`certificates/certificates.service.ts:202`** — `urlForSelf` (¡no
   estaba en el inventario v1!). A4 también la pasó por alto.

Las 3 son obsoletas: `prisma/schema.prisma:301` declara
`cognitoSub String? @unique @map("cognito_sub")` y la migración
`20260427_add_insured_cognito_sub` ya está aplicada. El comentario inline
en cada caso dice `"depende de la migración Sprint 4"` — Sprint 4 cerró,
los casts son deuda residual.

**Otros casts `as unknown` en el módulo (no obsoletos pero documentables)**:
- `insureds.service.ts:261, 263` — `bypass.client as unknown as ReadClient`
  (necesario, ReadClient es un alias estructural local).
- `insureds.service.ts:871, 926` — `filters as unknown as
  Prisma.InputJsonValue` / `Record<string, unknown>` (necesario, ExportFilters
  es Zod-inferred).
- `reports.service.ts:71` — `prisma.client as unknown as PrismaClient`
  (necesario).
- `packages.service.ts:92, 94` — `as unknown as PackageReadClient`
  (mismo patrón que insureds).

Sólo los 3 de `cognitoSub` son limpiables hoy.

## b) Correlaciones nuevas

### A1 reporta AuthService inyecta PrismaBypassRlsService directo. ¿`InsuredsService.findSelf` usa el mismo patrón?

**No**: `findSelf` (insureds.service.ts:672) usa `this.prisma.client` (path
RLS request-scoped, NOBYPASSRLS), porque el insured ya autenticó en su pool
y el JWT trae `req.tenant.id`. Es el patrón correcto.

`AuthService.findInsuredByCurp` necesita BYPASS porque el OTP request es
**pre-tenant** (no hay JWT aún). La asimetría es legítima — pero
A1-03 propone mover la lookup cross-tenant a
`InsuredsService.findByCurpCrossTenant()` para reducir la superficie de
auth. **Recomendación A5↔A1**: si Sprint 4 implementa el refactor, exponer
el método en `InsuredsService` (no nuevo `InsuredsLookupService`) — ya
tiene inyectado `PrismaBypassRlsService` y `clientFor(scope)` cubriría el
caso (`scope = { platformAdmin: true }` representa el "actor sin tenant").

### A4 reporta hash PDF roto. `urlForSelf` y verificación de integridad

**Confirmado y expandido**: re-leí `certificates.service.ts:183-251` y el
shape de retorno de `urlForSelf` es:

```typescript
{ url, expiresAt, certificateId, version, issuedAt, validTo }
```

**NO devuelve `hash`**. Aún cuando A4 corrija el bug del provisional hash,
el cliente del portal **no puede verificar integridad** sin re-fetch al
endpoint público `/v1/certificates/verify/:hash` — y el cliente no conoce
el hash.

Cross-cutting **B5↔A4↔A8**: el portal debería recibir `hash` en `urlForSelf`
para que el FE pueda hacer (a) display de "verificación: SHA-256 abc...",
(b) link directo `/v1/certificates/verify/${hash}` en una sección
"verificar autenticidad", (c) defense-in-depth re-cálculo del SHA del PDF
descargado vs el header (UX premium pero técnicamente factible con
WebCrypto). Hoy no es posible.

### A6 propone `@AuditCtx` decorator. ¿Cuántas veces se invoca `audit.record` en A5?

Conteo grep `auditWriter.record\|audit.record` en módulos del scope:

- `insureds.service.ts` — **2 sites** (find360, exportRequest).
- `claims.service.ts` — **1 site** (createForSelf).
- `workers/reports-worker.service.ts` — **2 sites** (export completed, export failed).
- `certificates.service.ts` — 1 site (urlForSelf, fuera de A5 pero del flow).
- `auth.service.ts` — 2 sites (otpRequest, otpVerify).

**Total en A5: 5 invocaciones** (3 user-facing + 2 worker-side). Patrón
verbatim en el controller para extraer `{ip, userAgent, traceId}`:

- `insureds.controller.ts:115-119` — find360.
- `insureds.controller.ts:173-177` — exportRequest.
- `certificates.controller.ts:79-82` — urlForSelf.

Las 3 copias son byte-idénticas (`req.ip ?? ''.toString() || undefined` +
`req.headers['user-agent']` typeguard + `req.id` typeguard). El
`@AuditCtx()` propuesto por A6 ahorra ~5 LOC × 3 sitios y unifica
semántica. Apoyo.

**Nota nueva**: `claims.controller.ts` **NO** extrae audit ctx — por lo
que `claims.service.createForSelf` registra audit sin `ip/userAgent/traceId`.
Inconsistencia: `find360`/`exportRequest`/`urlForSelf` propagan el contexto;
`createForSelf` (un POST que muta) lo omite. **Issue nuevo B5-04**.

### A8 reporta proxy cookie equivocada — ¿hay tests que verifiquen el HTTP path real?

`find` en `apps/portal/test`: **0 archivos** que matcheen `proxy*` o
`route*`. Los 13 tests del portal cubren componentes + libs, **ninguno**
toca `app/api/proxy/[...path]/route.ts`. No hay tests E2E backend↔portal
en `segurasist-api/test/` que validen el shape de cookie/Bearer del portal
(sólo admin via `auth.e2e-spec.ts`).

**Combinación letal**: A8-01 (proxy lee cookie equivocada) + B5-NN
(`useInsuredSelf`/`useCoveragesSelf`/`useCertificateMine`/`useCreateClaimSelf`
sin test E2E que valide el HTTP path real desde portal hasta backend).
**Tres áreas tienen tests unit verdes pero ningún test E2E demuestra que
los 4 endpoints insured-only funcionan con el portal real** — la cobertura
es ilusoria respecto del flujo end-to-end del producto.

## c) Re-leer código — observaciones nuevas

### `findSelf` / `coveragesForSelf` (Sprint 3 A1)

- `findSelf` (insureds.service.ts:664-716): el path lee
  `cognitoSub: user.cognitoSub` con cast obsoleto. El RBAC defensivo
  (`user.role !== 'insured'`) es correcto, pero **`user.cognitoSub`
  puede ser `undefined`** (el AuthUser de admin lo tiene undefined). El
  Prisma `findFirst({where:{cognitoSub: undefined}})` se traduce a
  `WHERE cognito_sub IS NULL` que va a **encontrar la primera insured
  con cognitoSub=NULL** (cualquier insured no-confirmado del tenant).
  El RBAC check anterior ya bloquea pero es defense-in-depth débil —
  un futuro refactor que olvide el role check leakea data. **Issue
  nuevo B5-01**.

- `coveragesForSelf` (insureds.service.ts:728-778): reusa `findSelf`
  para resolver `insuredId` — el lookup vuelve a hacer la misma query
  por `cognitoSub` (doble round-trip por petición). Aceptable hoy pero
  documental. Issue ya cubierto por A5-04 en v1.

### `createForSelf` (claims.service.ts)

- Mismo cast obsoleto (línea 82).
- **No propaga `ip/userAgent/traceId`** al audit (líneas 115-126), a
  diferencia de los otros endpoints insured-only del controller del
  insureds. Es un POST que muta DB — el audit forensics se pierde IP/UA
  cuando un insured reporta un claim. **B5-04**.
- Buen patrón: persiste `portalType` en `metadata` (preserva la
  granularidad medical/dental/pharmacy/other que el enum DB pierde).

### `reports.service.ts dashboard cache`

- `cached()` wrapper (líneas 378-394) tiene fail-open en `redis.get`
  (excelente) y `redis.set` (excelente). PERO si `JSON.parse(hit)` lanza
  (cache corrupto), el catch global cae fuera del wrapper → 500. **Issue
  nuevo B5-02**: envolver el `JSON.parse` en su propio try/catch para
  recomputar en caso de cache corrupto en lugar de propagar.
- `cacheTenantKey()` (líneas 78-83): si `scope.platformAdmin=false` y
  `scope.tenantId === undefined` (no debería pasar pero es defensivo),
  la key es `dashboard:unknown:*`. Defensa en profundidad correcta pero
  el comment no lo documenta — un atacante con manipulación de scope no
  alcanza este path porque RLS ya blinda, pero el log warning ayudaría.

### `exports.controller.ts` (Sprint 3 C parcial)

- 47 LOC, único endpoint `GET /v1/exports/:id`.
- Pasa `{id: userId}` al service — NO propaga `ip/userAgent/traceId`. El
  service `findExport` (insureds.service.ts:948-984) tampoco hace `audit.record`
  para la lectura del export status. **Polling cada 2-3s del FE no genera
  audit log** — aceptable (lectura de status sin PII), pero **el cliente
  exitoso descarga el presigned URL sin audit** (la URL se computa server-side
  en cada llamada). El `findExport` cuando devuelve `downloadUrl` debería
  registrar audit `action='read', resourceType='exports', subAction='downloaded'`.
  Sino, A6 chain hash queda sin evidencia de la descarga real. **B5-03**.

### `export-rate-limit.guard.ts` (sin tests confirmado)

Re-lectura del path completo:

- L37-38: `if (context.getType() !== 'http') return true;` — short-circuit
  correcto para tests jest unit (`getType=='rpc'` o similar).
- L41-42: kill switch via `process.env.THROTTLE_ENABLED`. **Lee de
  `process.env` directo, NO del `EnvSchema` Zod-validado**. El throttler
  global hace lo mismo (ver A6-06), así que es consistente — pero ambos
  exponen el mismo bug: `THROTTLE_ENABLED` no está en `env.schema.ts`,
  pasaría typo silencioso (`THROTTLE_ENABLE=true` → guard activo en
  prod cuando no se quería). Cross-cutting **B5↔A6↔A9**: A9 debería sumar
  `THROTTLE_ENABLED` al schema con default `true`.
- L51-58: bypass disabled fail-open — **WARN log pero return true**, sin
  alarma. En prod, una mala config `DATABASE_URL_BYPASS` desactivaría
  el cap PII silenciosamente. A6-07 reporta el mismo issue (`AuditWriter`
  pino-only sin alarma); patrón sistémico.

### `cursor.ts` (¿igual al de batches o duplicado?)

`grep` en `segurasist-api/src` para `cursor*.ts`:

- `modules/insureds/cursor.ts` (35 LOC).
- `modules/users/cursor.ts` (28 LOC).
- **NO existe `modules/batches/cursor.ts`** — el módulo batches NO usa
  cursor codec compartido. Verificado: `batches.service.ts:478` arma
  paginación distinta (`take`/`skip` directo en `findMany`).

Diff insureds↔users: idénticos en encode/decode/types. La única diferencia
es el comment header (insureds menciona `pg_trgm`/RLS context, users sólo
"mismo patrón"). **Confirmed** A5-NN v1: codec duplicado byte-para-byte.
Recomendación re-elevada: promover a `common/pagination/cursor.ts<T>` con
`T extends {id, createdAt}`.

Cross-cutting **A5↔A3**: si A3 expone listado paginado en Sprint 4 (issue
A3-16 menciona "preview sample top 10 rows" → potencial paginación), debe
reusar el codec compartido. Hoy es 0 lugares pero el feed deja la trampa
abierta.

## d) Tests — gaps verificados

### ¿14 tests Sprint 3 A1 cubren los 4 endpoints insured-only?

Conteo:

- `insureds.service.spec.ts` describes `findSelf` (5 tests: vigente,
  Forbidden role, NotFound cognitoSub, proxima_a_vencer, vencida,
  supportPhone — total 6 tests por mi conteo, no 5).
- `insureds.service.spec.ts` describe `coveragesForSelf` (2 tests:
  agg count+amount, Forbidden role).
- `claims.service.spec.ts` describe `createForSelf` (4 tests: happy
  path, Forbidden role, Zod description<10 chars, Zod occurredAt
  futuro).
- `certificates.service.spec.ts` describe `urlForSelf` (3 tests:
  happy path, NotFound, Forbidden).

**Total: 15 tests** (6+2+4+3 = no 14). El reporte v1 contó 14, conteo
v2 da 15. Discrepancia menor.

**Cobertura por endpoint**:

| Endpoint | Service test | Controller test | E2E | HTTP-real (vía portal proxy) |
|---|---|---|---|---|
| `GET /v1/insureds/me` | ✓ (6) | ✗ | ✗ | ✗ |
| `GET /v1/insureds/me/coverages` | ✓ (2) | ✗ | ✗ | ✗ |
| `POST /v1/claims` (insured) | ✓ (4) | ✗ | ✗ | ✗ |
| `GET /v1/certificates/mine` | ✓ (3) | ✗ | ✗ | ✗ |

**Gap crítico**: 0 tests E2E que ejerciten estos 4 endpoints con un JWT
del pool insured real. La cobertura unit asume que (a) `JwtAuthGuard` les
deja pasar (no testeado para insured pool), (b) `RolesGuard` enforza
`@Roles('insured')` (cubierto por `rbac.e2e-spec.ts` pero genérico), (c)
el portal proxy forwardea correctamente (NO cubierto, regresión A8-01).

**Confirmed cross-cutting**: la cadena insured-end-to-end **no tiene
ningún test que la ejerza completa**. Si A8-01 se arregla, no hay test
de regresión que valide que se rompió y luego se fijó.

### ¿Hay test que reproduce A5-01 MessageDeduplicationId fallido?

**No**. `sqs.service.spec.ts:28-35` testea que el comando se envía con
`MessageDeduplicationId` cuando se le pasa el arg, pero NO testea que
SQS real lo aceptaría (la cola es standard). El comment del test dice
`'incluye MessageDeduplicationId si se pasa (FIFO queues)'` — el comment
miente sobre el contexto. **Issue nuevo B5-05**: el test confirma el
bug en lugar de detectarlo. Para reproducir A5-01 se necesita o un
integration con LocalStack (que en este repo está skipeado por flag
A6-10) o un test que assert que la cola tenga sufijo `.fifo` cuando se
envía dedupeId.

### ¿Hay test de cursor encoding cross-module (insureds vs batches)?

**No** y **no aplica**: batches no usa cursor codec (verificado arriba).
Pero el codec insureds↔users sí está duplicado y NO hay test
cross-module que lo valide. `insureds.service.spec.ts:30-42` testea
round-trip + corruption + missing fields con la implementación local.
`users.service.spec.ts` (no leí entero pero) probablemente duplica los
mismos tests. Issue: el día que se promueva a `common/`, hay 2 sets de
tests que mantener o consolidar.

## Findings nuevos (B5-NN)

| ID | File:line | Severity | Category | Description | Recommendation |
|---|---|---|---|---|---|
| B5-01 | `src/modules/insureds/insureds.service.ts:672-675` + `claims.service.ts:81-84` + `certificates/certificates.service.ts:201-204` | Medium | Security/Defense-in-depth | Lookup `findFirst({where: {cognitoSub: user.cognitoSub, ...}})` con `user.cognitoSub: undefined` se traduce a `WHERE cognito_sub IS NULL` por Prisma — devuelve la primera insured no-confirmada del tenant en lugar de `null`. El RBAC role-check anterior bloquea hoy, pero un refactor que mueva el role check después del lookup leakearía datos cross-insured. | Agregar guard `if (!user.cognitoSub) throw new ForbiddenException(...)` ANTES del findFirst. Aplica en los 3 sites (findSelf, createForSelf, urlForSelf). Cubrir con un test que pase `cognitoSub: undefined` y assert ForbiddenException. |
| B5-02 | `src/modules/reports/reports.service.ts:381-383` | Low | Pattern/Resilience | `cached()` no envuelve `JSON.parse(hit)` en try/catch — si Redis devuelve un valor corrupto (otro proceso escribió en la misma key con shape distinta), el wrapper propaga el SyntaxError → 500. | Try/catch alrededor del parse → log warn + recompute. El path `redis.get` ya falla open; este último escalón también debería hacerlo. |
| B5-03 | `src/modules/insureds/insureds.service.ts:948-984` (findExport) | Medium | Security/Audit | Cuando `findExport` devuelve `downloadUrl`, no registra audit. El polling exitoso del FE genera N llamadas a `GET /v1/exports/:id`; cada una computa un presigned URL fresco sin trazabilidad. La descarga real (cliente → S3) tampoco emite evento (es client-side). Resultado: el evento `data.export.completed` (worker) queda como única evidencia, sin saber si el actor lo descargó. | Registrar `audit.record({action:'read', resourceType:'exports', subAction:'downloaded'})` cuando `status==='ready' && row.s3Key` y se computa la URL — fire-and-forget. Sumar IP/UA/traceId del request (requiere extender la firma de `findExport`). |
| B5-04 | `src/modules/claims/claims.controller.ts:31-39` | Medium | Pattern/Audit | `POST /v1/claims` (insured) NO extrae `{ip, userAgent, traceId}` del request y por tanto el `audit.record` en `createForSelf` (claims.service.ts:115-126) registra sin esos campos. Inconsistencia con find360, exportRequest, urlForSelf — los 3 endpoints comparables sí los propagan. Un claim reportado por un insured queda sin IP/UA en el audit chain. | Replicar el patrón de `insureds.controller.ts:115-119` (o el `@AuditCtx()` propuesto por A6) en `claims.controller.ts.create()` y propagar al service. |
| B5-05 | `src/infra/aws/sqs.service.spec.ts:28-35` | Medium | Test-coverage | Test `'incluye MessageDeduplicationId si se pasa (FIFO queues)'` valida que el comando del SDK contiene el dedupeId, pero las colas LocalStack (`localstack-bootstrap.sh:138-143`) y la `.env.example:55` son standard. El test confirma el bug A5-01 en lugar de detectarlo — passes verde mientras el código es funcionalmente roto en AWS real. | Cambiar el assert: si la queueUrl no termina en `.fifo`, el comando NO debe contener `MessageDeduplicationId` (lanzar warning o filtrar en SqsService). Alternativa: agregar test integration con LocalStack que cree una cola FIFO real y verifique idempotencia end-to-end. |
| B5-06 | `src/modules/insureds/export-rate-limit.guard.ts:41-42` + `src/app.module.ts:91` | Low | DevOps/Drift | `THROTTLE_ENABLED` se lee de `process.env` directo en 2 sitios (guard + ThrottlerGuard global), no via `EnvSchema` Zod-validado. Typo en env (`THROTTLE_ENABLE=true`) deja activo cuando se quería deshabilitar (o vice-versa). Cross-cutting con A6-06 (default 10000 limit en NODE_ENV=test). | Sumar `THROTTLE_ENABLED: z.coerce.boolean().default(true)` al `env.schema.ts` y consumir `env.THROTTLE_ENABLED` en ambos sites. |
| B5-07 | `apps/portal/test/` + `segurasist-api/test/e2e/` | High | Test-coverage | Los 4 endpoints insured-only (`/v1/insureds/me`, `/me/coverages`, `/v1/claims` POST, `/v1/certificates/mine`) NO tienen test E2E con JWT del pool insured real ni test de proxy del portal. La cadena completa (portal → middleware → proxy → backend → DB) está cubierta SÓLO en unit (mocks) — A8-01 (proxy cookie wrong) explotó este gap en producción y no hubo test que lo detectara. Cross-cutting con A8 + A10. | Crear `test/e2e/insured-portal.e2e-spec.ts` con: (1) login OTP del pool insured (cognito-local), (2) GET /v1/insureds/me retorna shape esperado, (3) GET /v1/insureds/me/coverages, (4) POST /v1/claims (insured), (5) GET /v1/certificates/mine. Adicionalmente, un test del proxy del portal (Vitest con MSW o similar) que assert `Authorization: Bearer <portal-token>` se forwardea correctamente. |

## Cross-cutting concerns (re-elevados)

- **A5↔A4↔A8 (hash integrity portal)**: `urlForSelf` no devuelve `hash`.
  Aún si A4 corrige el bug provisional → SHA real, el portal no puede
  verificar integridad sin re-fetch al verify endpoint público (que
  además requiere conocer el hash). Recomendación cross-area:
  `urlForSelf` agregue `hash: cert.hash` y el FE muestre "Verificado:
  abc123…" con link a `/verify/${hash}`.
- **A5↔A6 (audit ctx decorator)**: 3 sitios duplican el patrón de
  extracción `{ip, userAgent, traceId}`; el 4to (claims controller) lo
  omite por completo. Apoyo full a `@AuditCtx()` decorator de A6,
  agregando `claims.controller` al rollout.
- **A5↔A1 (lookup cross-tenant)**: si A1 implementa
  `InsuredsService.findByCurpCrossTenant()`, exponerlo en el mismo
  service que ya tiene `clientFor(scope)` con bypass.
- **A5↔A3 (cursor codec compartido)**: hoy duplicado users↔insureds;
  batches no usa cursor pero su preview/list pageado de Sprint 4
  necesitará uno. Promover a `common/pagination/cursor.ts<T>` ANTES
  que A3 cree una 3ra copia.
- **A5↔A8 (test E2E ausente)**: la combinación A8-01 (proxy bug) +
  B5-07 (cero tests E2E insured) es el peor caso del feed — un fix
  shipped sin red de seguridad. Prioridad alta para Sprint 4.

## Revisión de severidades v1 → v2

| ID v1 | Severidad v1 | Severidad v2 | Motivo |
|---|---|---|---|
| A5-06 buildInsuredsWhere | Medium | **High** | 3 copias byte-iguales hoy, ningún test cross-copy detecta divergencia; un filter nuevo en Sprint 4 va a romper el matching list↔export silentemente. |
| A5-02 cast obsoleto | Low | Low (sin cambio) | Pero ahora son 3 sites no 2 (cert también). |
| A5-04 coveragesForSelf N+1 | Medium | Medium (sin cambio) | A confirmado en re-lectura; aceptable hoy. |

## Recommendations Sprint 4 (top 5 v2)

1. **Cerrar B5-07** (E2E insured-only): bloqueante para confianza en el
   portal. 1 spec con 5 cases + 1 test del proxy. Sin esto, A8-01 puede
   re-aparecer.
2. **Cerrar A5-06 v2 (High)**: extraer `buildInsuredsWhere` SHARED entre
   `list`, `buildExportWhere` y `reports-worker.queryInsureds`. Bloquea
   regresiones cuando agreguen `entidad` u otro filtro.
3. **Cerrar B5-01** (defense-in-depth `cognitoSub`): agregar guard
   pre-findFirst en los 3 sites + test. Trivial, alto valor de seguridad.
4. **Cerrar A5-03** (tests `ExportRateLimitGuard`): 5 cases mínimos.
   Bloquea evidencia compliance del cap PII.
5. **Cerrar A5-02 + cast cert**: limpieza de los 3 `as unknown as
   Prisma.InsuredWhereInput` ahora que la migración cognitoSub cerró.

## Notas

- v1 contó 14 tests insured-only; conteo v2 da 15 (6+2+4+3). Discrepancia
  menor; ambos confirman cobertura unit aceptable.
- 3er agente reporta MessageDeduplicationId rota: A3-31 + A5-01 v1 + esta
  re-revisión. Es **issue sistémico de la capa SQS, no específico A5**.
- A2-03 (cognitoSub schema drift @unique vs partial UNIQUE) es relevante
  para A5: si `prisma migrate diff` corre en CI con drift, los tests
  unit del scope siguen verdes pero el path de prod podría no permitir
  inserts pre-OTP. Coordinar con A2 + A10.
