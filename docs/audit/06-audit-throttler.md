# Audit Report — Audit log + Throttler + Hardening cross-cutting (A6)

## Summary (≤10 líneas)

El área A6 está implementada con un nivel de rigor notable: hash chain SHA-256
con `SELECT ... FOR UPDATE`, canonical JSON con keys ordenadas, mirror inmutable
a S3 con Object Lock COMPLIANCE 730d, verificador cross-source DB↔S3 que filtra
filas pendientes de mirror, throttler de doble bucket (user-IP + tenant) con
fail-open en Redis, RFC 7807 Problem Details que ya preserva el HTTP status
original (M1), y CSP `default-src 'none'` activa siempre. Tests cubren los
escenarios críticos (tampering DB, immutability S3, doble bucket, ataque
distribuido tenant). Hallazgos relevantes: depth máximo del scrub recursivo en
`AuditInterceptor` está hard-coded a 8 (vs 12 en la utility canónica), lista
`SENSITIVE_KEYS` duplicada entre `audit.interceptor.ts` y `scrub-sensitive.ts`
(riesgo de drift), `verify-chain` sin `@TenantThrottle` (operación cara: full
scan + S3 download), `THROTTLE_LIMIT_DEFAULT=10000` en `NODE_ENV=test` que
puede enmascarar regressions, y `recompute` ligero en `AuditChainVerifier`
sólo valida prev_hash sin recomputar SHA (gap potencial vs full DB
verifyChain).

## Files audited

23 archivos en scope (3811 LOC):

- `segurasist-api/src/modules/audit/`:
  - `audit-writer.service.ts` (382 LOC) + spec (316 LOC)
  - `audit-s3-mirror.service.ts` (401 LOC)
  - `audit-chain-verifier.service.ts` (154 LOC)
  - `audit-hash.ts` (88 LOC)
  - `audit-persistence.module.ts`, `audit.module.ts`, `audit.controller.ts`,
    `audit.service.ts`, `audit-cursor.ts`
- `segurasist-api/src/common/interceptors/`:
  - `audit.interceptor.ts` + spec
  - `tenant-override-audit.interceptor.ts` + spec
  - `trace-id.interceptor.ts` + spec, `timeout.interceptor.ts` + spec
- `segurasist-api/src/common/throttler/`:
  - `throttler.guard.ts`, `throttler-redis.storage.ts`, `throttler.decorators.ts`,
    `throttler.module.ts`, `throttler.types.ts` + 2 specs
- `segurasist-api/src/common/filters/http-exception.filter.ts` + spec
- `segurasist-api/src/common/utils/scrub-sensitive.ts`,
  `file-magic-bytes.ts` + 1 spec (file-magic-bytes)
- `segurasist-api/src/main.ts`, `app.module.ts`
- `test/integration/audit-mirror-flow.spec.ts`,
  `test/integration/object-lock-immutability.spec.ts`,
  `test/integration/verify-chain-cross-source.spec.ts`,
  `test/integration/throttler.spec.ts`,
  `test/integration/audit-interceptor.spec.ts`,
  `test/integration/security-headers.spec.ts`,
  `test/unit/observability/logger-redact.spec.ts`

## Strengths (qué está bien hecho)

1. **Hash chain robusto**: `audit-writer.service.ts:172-216` envuelve
   `SELECT prev row_hash FOR UPDATE` + `INSERT` en `$transaction`,
   serializando writes concurrentes del mismo tenant. El `occurredAt` se
   computa en app y se pasa explícito al hash y al insert (evita drift
   app↔db default `now()`).
2. **Canonical JSON propio (no `JSON.stringify`)**: `audit-hash.ts:26-48`
   ordena keys lexicográfica y recursivamente, omite `undefined`, normaliza
   `null`. Determinístico ⇒ tampering = hash mismatch garantizado. Los
   tests verifican que `{a:1,b:2}` y `{b:2,a:1}` colisionan en el hash.
3. **Defensa en profundidad S3 Object Lock**: `audit-s3-mirror.service.ts`
   espeja cada fila a NDJSON con SSE-KMS y default retention COMPLIANCE
   730d. El cross-source verifier (`audit-chain-verifier.service.ts:53-103`)
   filtra filas con `mirroredToS3=false` para evitar falsos positivos
   durante la ventana eventual de 60s, y reporta `missing_in_s3`,
   `missing_in_db`, `row_hash_mismatch` con info forensics.
4. **Fail-open Redis + kill-switch**: `throttler-redis.storage.ts:79-86`
   captura excepciones y devuelve `totalHits=0` (sirve tráfico si Redis
   cae). `throttler.guard.ts:79-80` honra `THROTTLE_ENABLED=false|0` para
   incidentes y E2E.
5. **Doble bucket con header transparente**: `throttler.guard.ts:139-159`
   reporta `X-RateLimit-Limit/Remaining/Reset` del bucket más restrictivo
   y agrega `X-RateLimit-Scope=user|tenant` cuando bloquea — debug
   inmediato para frontend.
6. **HttpExceptionFilter preserva status original (M1)**:
   `http-exception.filter.ts:74` usa `statusOverride` en `buildProblem` →
   `HttpException(503)` ahora responde 503 (antes reescribía a 500).
   Cubierto por test `M1: HttpException(503) preserva status 503`.
7. **CSP siempre activa**: `main.ts:44-54` registra helmet con
   `default-src 'none'` + `frame-ancestors 'none'` + `base-uri/form-action
   'none'` y HSTS 2y preload — apropiado para API REST sin HTML.
   `security-headers.spec.ts` valida los headers.
8. **`verifyChain` con tampering test real**: `audit-writer.service.spec.ts:267`
   muta `payloadDiff` post-insert y confirma `valid=false` con `brokenAtId`.

## Issues found

| ID | File:line | Severity | Category | Description | Recommendation |
|---|---|---|---|---|---|
| A6-01 | `src/common/interceptors/audit.interceptor.ts:11-30` | Medium | Maintainability/Security | Lista `SENSITIVE_KEYS` (interceptor) duplicada literalmente en `scrub-sensitive.ts:23-38` (`SENSITIVE_LOG_KEYS`); ambos comments dicen "mantener sincronizado" pero no hay constraint. Drift inevitable: si el interceptor agrega `sessionToken` y la utility no, el log de pino lo deja pasar. Además el interceptor `redact()` usa `depth > 8` y la utility `MAX_DEPTH = 12` — depth distinta para el mismo objetivo. | Re-export `SENSITIVE_LOG_KEYS` desde `scrub-sensitive.ts` y borrar la copia local; consumir `scrubSensitiveDeep` directamente en el interceptor (`payloadDiff = scrubSensitiveDeep(merged)`), unificando depth=12. |
| A6-02 | `src/modules/audit/audit-chain-verifier.service.ts:140-153` | High | Test-coverage/Security | `recomputeChainOkFromDb` (path `source='both'`) **NO** recomputa el SHA-256 fila a fila — sólo encadena `prevHash`. Comentario explícito: "check ligero, no recompute SHA". Si un actor con BYPASSRLS hace UPDATE coordinado de `payloadDiff` y `rowHash` consistente entre sí pero distinto del original, la cadena DB queda "encadenada" y ESTE check pasa; sólo el cross-check con S3 lo detecta. Si por la razón que sea S3 está rezagado o vacío para ese tenant (`!mirroredToS3`), el tampering pasa silencioso. | Reemplazar el `recomputeChainOkFromDb` ligero por una llamada a `runVerification` (la full SHA recompute exportada de `audit-writer.service.ts`) — el costo extra es marginal (SHA-256 sobre filas ya en memoria). |
| A6-03 | `src/modules/audit/audit.controller.ts:63-77` | High | Security/Performance | `GET /v1/audit/verify-chain` está bajo `@Roles('admin_segurasist')` pero no lleva `@Throttle` ni `@TenantThrottle`. Usa default user-IP 60/min, pero la operación es muy cara: full table scan del audit_log del tenant (puede ser 100k+ filas) + ListObjectsV2 + GetObjectCommand de cada NDJSON + parse línea-a-línea. Un superadmin con creds comprometidas puede DoS al cluster lanzando verify-chain cross-tenant a varios IDs. | Aplicar `@Throttle({ ttl: 60_000, limit: 5 })` + `@TenantThrottle({ ttl: 3_600_000, limit: 20 })` (decorator no-op si super no trae req.tenant; documentado como forward-compat). Considerar timeout específico (>15s default) o stream-parsing para tenants grandes. |
| A6-04 | `src/common/interceptors/audit.interceptor.ts:29-47` | Medium | Maintainability | `redact()` interno reimplementa `scrubSensitiveDeep` con depth=8 y misma intención; está marcado en el comment como "mantener sincronizado". Solapa con A6-01. | Eliminar la función local; usar `scrubSensitiveDeep` directo. |
| A6-05 | `src/common/throttler/throttler.guard.ts:140-145` | Medium | Clarity | Cuando `tenantId` está presente, `tenantIsTighter` se computa con `tenantRemaining < userRemaining` — pero los headers exponen el bucket más restrictivo SÓLO si el comparador estricto cae al tenant. En empate (mismos remaining) el cliente ve `userLimit` aunque el tenant esté igualmente cerca de explotar. Es minor pero confunde dashboards. | Cambiar a `tenantRemaining <= userRemaining` para reportar tenant en empate (matchea la heurística del bloqueo `blockedByTenant` línea 155). |
| A6-06 | `src/app.module.ts:89-92` | Medium | Test-coverage | `THROTTLE_LIMIT_DEFAULT` en `NODE_ENV=test` se setea a `10_000`. Esto enmascara regresiones de rate-limit en E2E (un endpoint cuyo `@Throttle` se borre por accidente nunca se nota en CI). | Mantener default permisivo pero sumar un suite específico que monte AppModule con `THROTTLE_ENABLED=true` y `THROTTLE_LIMIT_DEFAULT=10` para validar que cada `@Throttle` declarado sigue activo. |
| A6-07 | `src/modules/audit/audit-writer.service.ts:110-117` | Medium | Security/Structure | Si `DATABASE_URL_AUDIT` no está definido, el writer entra en modo "pino-only" — silencia toda persistencia y se queda solo el log estructurado. El warning está claro y hay comment de M2, pero no hay alarma operativa: en prod, una mala config puede pasar inadvertida hasta que alguien intente `verify-chain` (que sí lanza `NotImplementedException`). | Añadir health indicator dedicado (`AuditWriterHealthIndicator`) que reporte `degraded` cuando el writer corre sin BD, expuesto en `/health/ready`. Validar la var en `env.schema.ts` cuando M2 cierre (ya hay TODO en línea 114). |
| A6-08 | `src/modules/audit/audit-s3-mirror.service.ts:81` | Low | Pattern | `batchLimit` y `intervalMs` se leen directamente de `process.env.AUDIT_MIRROR_BATCH_LIMIT` / `AUDIT_MIRROR_INTERVAL_MS` con `Number(...)` sin validar (p.ej. NaN si vienen como `"foo"`, o 0 si está vacío). El resto del repo usa `env.schema.ts` (Zod) para coerción tipada. | Mover ambas a `env.schema.ts` con coerción y default. |
| A6-09 | `src/modules/audit/audit-s3-mirror.service.ts:208-213` | Low | Clarity | `batchId` se construye con `new Date().toISOString().replace(...)` dentro del loop — si dos `runOnce()` se solapan o dos grupos entran en el mismo ms (rare pero posible bajo carga), dos NDJSON podrían colisionar en key (mismo `batchId`). Probabilidad baja por el lock `running` y el orden lex-único, pero no determinístico. | Sufijar `batchId` con `randomBytes(2).toString('hex')` o un counter monotónico per-tick. |
| A6-10 | `test/integration/audit-mirror-flow.spec.ts` y `verify-chain-cross-source.spec.ts` | Low | Test-coverage | Ambas suites se autoskipean (`if (skip) return`) cuando LocalStack no está arriba. CI puede pasar sin ejecutar ningún test del path S2-07. | Marcar el suite con tag `requires:localstack` (p.ej. via `describe.skip` controlada) y exigir en pipeline una etapa con LocalStack obligatorio que valide presencia de todos los tests. |
| A6-11 | `src/common/utils/scrub-sensitive.ts` | Medium | Test-coverage | No existe `scrub-sensitive.spec.ts` dedicado — la cobertura del depth=12 corte y de objetos no-plain (`Date`, `Buffer`) sólo se ejerce indirectamente vía `logger-redact.spec.ts` (que cubre profundidad 20 y verifica que no cuelgue, pero no asserta el `[REDACTED]` en el corte). | Crear `src/common/utils/scrub-sensitive.spec.ts` con: (a) profundidad exacta 12 vs 13 → assert `[REDACTED]` en el cutoff, (b) Date / Buffer pasan sin tocar, (c) objeto cíclico no cuelga, (d) sensitive key dentro de array de arrays. |
| A6-12 | `src/common/throttler/throttler.guard.ts:142` | Low | Clarity | El check `tenantId !== undefined` se podría reemplazar por `tenantId !== undefined && tenantRemaining < userRemaining`; ya está, pero la inicialización `tenantRemaining = Number.POSITIVE_INFINITY` genera un comparador raro contra remaining number — clearer intent: usar `let tenantRemaining: number \| null = null`. | Refactor cosmético. |
| A6-13 | `src/common/utils/file-magic-bytes.ts:50-91` | Low | Pattern | La heurística CSV permite cualquier byte ≥0x80 (UTF-8 multibyte) sin validar la secuencia. Un EXE con bytes altos `< 0x20` salvo `0x09/0A/0D` queda rechazado, pero un payload binario válido UTF-8 (raro pero posible: GIF89a con cabecera `47 49 46 38 39 61` → todo printable) puede pasar como CSV. El comment ya admite la heurística MVP. | Documentar explícitamente en el JSDoc (ya parcial) y agregar test que dispara con header GIF/PNG ASCII-printable para confirmar que el parser CSV upstream lo rechaza con VALIDATION_ERROR (defense-in-depth claim). |
| A6-14 | `src/common/interceptors/timeout.interceptor.ts:11-22` | Low | Pattern | Timeout fijo 15s hard-coded en main.ts. Endpoints de export (XLSX) y batches con archivos cerca de 25 MB pueden razonablemente excederlo (parser + S3 upload). No se aplica a workers/SQS handlers. | Permitir override per-handler vía `@Timeout(ms)` decorator + reflection. Documentar valores por endpoint pesado. |

## Cross-cutting concerns (afectan a otras áreas)

- **Hacia A1 (Auth)**: `auth.service.ts:53,116` ya inyecta `AuditWriterService`
  como `@Optional()` — si el writer está en modo pino-only (A6-07), eventos
  de login/MFA/refresh no quedan en BD. Coordinar con A1 que la criticidad
  del audit de login amerita gateo del boot cuando la var está ausente en
  staging+prod.
- **Hacia A2 (Multi-tenant + RLS)**: `verifyChain` (controller) usa el
  `PrismaClient` propio de `AuditWriterService` (BYPASSRLS via
  `DATABASE_URL_AUDIT`). Si M2 consolida bypass-rls en
  `PrismaBypassRlsService`, deduplicar conexiones. La política RLS sobre
  `audit_log` debe permitir `INSERT` desde `segurasist_admin` y `SELECT`
  filtrado por `tenant_id` para `segurasist_app`.
- **Hacia A3 (Batches)**: `BatchesController` aplica
  `@TenantThrottle({ttl:60_000,limit:100})` correctamente. `detectFileType`
  (A6-13) es la última línea de defensa antes del worker — recomendado un
  test cross-cutting que valide rejection de EXE/PE/Mach-O en el endpoint
  POST /v1/batches, no sólo en el unit test de la utility.
- **Hacia A5 (Insureds + Reports)**: `/v1/insureds/export` usa
  `@Throttle({ttl:60_000,limit:1})` (user-IP) + `ExportRateLimitGuard`
  (DB count tenant), pero NO `@TenantThrottle`. El doble bucket no se
  computa para esta ruta y un usuario con IP rotativa puede saturar el
  cap diario sin quemar el bucket Redis. Considerar agregar
  `@TenantThrottle({ttl:60_000,limit:10})` para coherencia con el patrón
  del repo (ya documentado en `throttler.decorators.ts:31`).
- **Hacia A9 (DevOps)**: el bucket S3 con Object Lock COMPLIANCE 730d debe
  estar Terraformeado con `object_lock_configuration` y default retention.
  `audit-s3-mirror.service.ts:226` confía en el default-bucket — sin la
  config de Terraform, los PUT no llevan retención y la inmutabilidad se
  rompe. Coordinar test E2E que valide `GetObjectLockConfiguration` post-
  bootstrap.
- **Findings feed (append)**:
  - `[A6] 2026-04-25 16:00 High audit-chain-verifier.service.ts:140 — recomputeChainOkFromDb sólo encadena prev_hash sin recomputar SHA, pueden filtrarse tampering coordinados pre-mirror. // Impacta A2 (RLS bypass tampering).`
  - `[A6] 2026-04-25 16:00 High audit.controller.ts:63 — verify-chain sin @Throttle/@TenantThrottle puede DoS al cluster (full scan + S3 download). // Impacta A2/A9.`
  - `[A6] 2026-04-25 16:00 Medium audit.interceptor.ts:11 + scrub-sensitive.ts:23 — listas SENSITIVE_KEYS duplicadas con depth distinta (8 vs 12). // Impacta A1/A4 (PII en logs).`

## Recommendations Sprint 4

1. **Cierre A6-01 + A6-04**: Eliminar `redact()` y `SENSITIVE_KEYS` locales
   del `AuditInterceptor`; consumir `scrubSensitiveDeep` con depth=12 como
   única fuente de verdad. Agregar lint rule (eslint custom o grep CI) que
   prohíba `SENSITIVE_KEYS` fuera de `scrub-sensitive.ts`.
2. **Cierre A6-02**: Reemplazar `recomputeChainOkFromDb` ligero por la full
   SHA recompute (`runVerification`) en el path `source='both'`. Sumar test
   "tampering coordinado de payloadDiff+rowHash en DB con S3 vacío" que
   demuestre la detección.
3. **Cierre A6-03**: Aplicar `@Throttle` y `@TenantThrottle` estrictos al
   endpoint `/v1/audit/verify-chain`. Considerar mover el verify a un
   worker SQS asíncrono (`POST` encola, `GET` polea resultado) cuando
   tenants superen N filas.
4. **Cierre A6-07**: Health indicator `AuditWriterHealthIndicator` que
   reporte `degraded` si `client === null`. Cuando M2 aterrice, mover
   `DATABASE_URL_AUDIT` a `required` en `env.schema.ts` y eliminar el
   fallback pino-only.
5. **Cierre A6-11**: Crear suite dedicado `scrub-sensitive.spec.ts` con
   ≥6 casos (depth cutoff, Date/Buffer pass-through, ciclos, arrays
   anidados, claves ausentes, payload XSS). Subir cobertura a 100% del
   archivo.

## Notas adicionales

- Tests del hash chain (`audit-writer.service.spec.ts`) son ejemplares:
  fake Prisma con simulación de `FOR UPDATE` per-tenant, verificación de
  determinismo, encadenamiento, tampering y aislamiento entre tenants.
- `tenant-override-audit.interceptor.ts` aplica correctamente a GET/HEAD/
  OPTIONS solamente (read-side audit), evitando duplicar la fila que el
  `AuditInterceptor` estándar ya emite con `_overrideTenant` para
  mutaciones (línea 49 + spec línea 53). Coordinación limpia.
- El throttler guard documenta explícitamente que se ejecuta DESPUÉS de
  `JwtAuthGuard` (`throttler.guard.ts:48`), lo cual es correcto pero
  depende del orden de declaración en `app.module.ts:114-126`. Sería más
  robusto un comment + test que verifique el orden con `getProviders()`
  introspection, dado que un refactor podría romperlo silenciosamente.
