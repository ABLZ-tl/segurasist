# Fix Report — F6 B-AUDIT

## Iter 1 (resumen)

### Issues cerrados

| ID | File:line | Naturaleza del fix |
|---|---|---|
| **C-10** | `src/modules/audit/audit-chain-verifier.service.ts:91-130` + `src/modules/audit/audit-writer.service.ts:341-381` | Exportada `runVerification(rows: AuditChainVerifiableRow[])` desde audit-writer (antes era helper interno). `verify(source='both')` invoca `runVerification(dbVerifiableRows)` para recompute SHA-256 COMPLETO en lugar del light path `recomputeChainOkFromDb` (eliminado, comentario inline 177-180 explica por qué). Tampering coordinado payloadDiff+rowHash matching que pasaba silencioso ahora detectado: si la fila NO está mirroreada todavía → SHA recompute fail; si SÍ está mirroreada → cross-check DB↔S3 detecta `row_hash_mismatch` contra ground-truth Object Lock COMPLIANCE. Cuando el SHA recompute en DB falla, agregamos discrepancy `row_hash_mismatch` con solo `db.rowHash` (caso "tampering pre-mirror" antes invisible). |
| **H-01** | `src/modules/audit/audit-context.factory.ts` (NUEVO) + `src/common/utils/scrub-sensitive.ts:1-100` + `src/common/interceptors/audit.interceptor.ts:1-15` + `prisma/schema.prisma:153-191` + `prisma/migrations/20260428_audit_action_enum_extend/migration.sql` (NUEVO) | (a) `AuditContextFactory` request-scoped que devuelve `{actorId, tenantId, ip, userAgent, traceId}` desde `FastifyRequest`; registrado en `AuditPersistenceModule` (@Global). (b) Lista única `SENSITIVE_LOG_KEYS` + alias retro-compat `SENSITIVE_KEYS` + `MAX_SCRUB_DEPTH=10` (consolidación de los anteriores 12 vs 8). El interceptor importa `scrubSensitive` y lo reexpone como `redact` sin romper tests. (c) Enum `AuditAction` extendido con `otp_requested`, `otp_verified`, `read_viewed`, `read_downloaded`, `export_downloaded` + migration `ALTER TYPE … ADD VALUE IF NOT EXISTS` (Postgres 12+, sin downtime). `AuditEvent.action` ahora usa el type-union `AuditEventAction`. |
| **H-02** | `src/modules/audit/audit.controller.ts:63-73` | `@Throttle({ ttl: 60_000, limit: 2 })` en `GET /v1/audit/verify-chain`. Operación cara (full table scan + ListObjectsV2 + GetObject NDJSON + recompute SHA por fila) → sin throttle, superadmin con creds comprometidas DoS-eaba el cluster. 2/min/IP suficiente para forensics manual. |
| **H-24** | `src/modules/claims/claims.controller.ts:1-46` + `src/modules/claims/claims.service.ts:77-140` | Controller inyecta `AuditContextFactory`, pasa `auditCtx.fromRequest()` como 3er argumento opcional a `ClaimsService.createForSelf(user, dto, auditCtx)`. Service propaga `ip`, `userAgent`, `traceId` al `auditWriter.record(...)`. El spec existente sigue pasando porque el 3er arg es opcional. |

### Files modificados

- `segurasist-api/src/modules/audit/audit-chain-verifier.service.ts` — refactor full SHA path; eliminado `recomputeChainOkFromDb` light path.
- `segurasist-api/src/modules/audit/audit-writer.service.ts` — exportadas `runVerification` y `AuditChainVerifiableRow`; tipo `AuditEventAction` agregado.
- `segurasist-api/src/modules/audit/audit-persistence.module.ts` — registra `AuditContextFactory`.
- `segurasist-api/src/modules/audit/audit.controller.ts` — `@Throttle` en `verify-chain`.
- `segurasist-api/src/common/interceptors/audit.interceptor.ts` — eliminada lista local; importa `scrubSensitive` desde el utility único.
- `segurasist-api/src/common/utils/scrub-sensitive.ts` — lista canónica única + `MAX_SCRUB_DEPTH=10` + alias `SENSITIVE_KEYS` y función `scrubSensitive`.
- `segurasist-api/src/modules/claims/claims.controller.ts` — inyecta `AuditContextFactory`.
- `segurasist-api/src/modules/claims/claims.service.ts` — `createForSelf` acepta `auditCtx?` y propaga al writer.
- `segurasist-api/prisma/schema.prisma` — enum `AuditAction` extendido (sección owned por F6; F4 tocó model `Batch` sin colisión).

### Files nuevos

- `segurasist-api/src/modules/audit/audit-context.factory.ts` — `@Injectable({scope: Scope.REQUEST})` factory.
- `segurasist-api/prisma/migrations/20260428_audit_action_enum_extend/migration.sql` — `ALTER TYPE` idempotente con IF NOT EXISTS.
- `segurasist-api/test/integration/audit-tampering.spec.ts` — 5 tests (C-10).

### Tests añadidos

- `test/integration/audit-tampering.spec.ts` (NUEVO):
  - **runVerification: tampering coordinado partial (sin re-firma downstream)** — atacante actualiza `payloadDiff` + `rowHash` matching, pero olvida actualizar `prev_hash` de filas siguientes → break detectado en la fila siguiente.
  - **runVerification: tampering simple sin re-firmar `rowHash`** — atacante naive solo modifica `payloadDiff`; `rowHash` queda stale → SHA recompute != rowHash, detectado (path antiguo light NO lo detectaba).
  - **runVerification: cadena íntegra** — N filas válidas → `valid=true`, sin `brokenAtId`.
  - **verify(source='both'): tampering coordinado post-mirror** — fila ya mirroreada, atacante UPDATE `payloadDiff+rowHash` consistente DB-side; cross-check DB↔S3 detecta `row_hash_mismatch` con S3 como ground-truth (Object Lock).
  - **verify(source='both'): tampering simple** — `payloadDiff` mutado, `rowHash` stale; suite skip-safe si LocalStack no está up.

### Tests existentes corridos

- NO ejecutados localmente. Sandbox del entorno bloqueó `pnpm test` / `pnpm jest` / `npx jest`. Documentado en `_fixes-feed.md` para que F0 los corra en validation gate.
- Validación pendiente: `cd segurasist-api && pnpm test -- audit claims scrub`. Suites afectadas:
  - `src/modules/audit/audit-writer.service.spec.ts` (debe seguir verde — agregamos export pero no cambiamos signature interna).
  - `src/common/interceptors/audit.interceptor.spec.ts` (debe seguir verde — `__test.redact` sigue exportado vía alias).
  - `src/modules/claims/claims.service.spec.ts` (3er arg opcional → sin breakage).
  - `test/integration/verify-chain-cross-source.spec.ts` (debe seguir verde — la nueva discrepancy adicional `row_hash_mismatch` solo se agrega cuando hay tampering, no en cadena íntegra).

### Cross-cutting findings (en feed)

- **NEW-FINDING auth.service.ts:231/318** — `auditWriter.record({...})` sigue usando `action: 'login'` con `resourceType: 'auth.otp.requested'/'auth.otp.verified'` overload + SIN `ip/userAgent/traceId`. F2 owner iter 1; **migración a `action: 'otp_requested'/'otp_verified'` + `AuditContextFactory.fromRequest()` es F6 iter 2**.
- **NEW-FINDING insureds.service.ts:625/911** — ya tienen ctx pero shape custom `audit?.ip`. F10 owner iter 1; migración a `AuditContextFactory.fromRequest()` + `action: 'read_viewed'` (línea 631) en F6 iter 2.
- **NEW-FINDING certificates.service.ts:225** — `payloadDiff: { subAction: 'downloaded' }` con `action: 'read'` overload → migrar a `action: 'read_downloaded'` + `AuditContextFactory.fromRequest()`. F1 owner iter 1; **F6 iter 2**.
- **NEW-FINDING reports-worker.service.ts:216/240** — workers SQS no tienen `req` HTTP → `AuditContextFactory` N/A. Documentado para review iter 2; sin migración planeada (los logs del worker llevan `traceId` via SQS attributes en futuro, fuera de scope).

### Decisiones arquitectónicas / coordinaciones

- **AuditContextFactory request-scoped**: cualquier service que lo inyecte se vuelve request-scoped (igual patrón que `PrismaService`). Coordinado con el patrón existente; sin sorpresas para los downstream services iter 2.
- **Enum AuditAction extend vs separate table**: optamos (a) extend enum (decisión 10.3 del AUDIT_INDEX). Migration usa `ADD VALUE IF NOT EXISTS` — no toca filas existentes. Backward compatible.
- **scrub-sensitive depth=10**: bajado de 12 (pino) y subido de 8 (interceptor). El depth 10 es razonable para payloads JSON del dominio (DTOs anidados con metadata); cualquier caso > 10 niveles es probablemente cíclico → cortamos defensivamente.

## Iter 2 (resumen)

### Issues cerrados — Follow-ups iter 1

| Follow-up | File:line | Naturaleza del fix |
|---|---|---|
| **FU-1.1** | `auth.service.ts:231` (otpRequest) + `auth.controller.ts` | Sustituido `action: 'login'` + `resourceType: 'auth.otp.requested'` (overload semántico previo) por `action: 'otp_requested'` (enum extendido) + `resourceType: 'auth'`. Service acepta `auditCtx?: AuditContext` opcional como 2do arg; controller inyecta `AuditContextFactory` y pasa `auditCtx.fromRequest()`. AuthService NO se vuelve request-scoped (decisión: pasar `AuditContext` por parameter en vez de inyectar el factory request-scoped — preserva el scope default del service y evita churn del connection pool en cada login). |
| **FU-1.2** | `auth.service.ts:330` (otpVerify) | Análogo: `action: 'otp_verified'` + ctx via parameter. |
| **FU-1.3** | `insureds.service.ts:625-638` (find360) + `insureds.controller.ts` | `find360` ahora acepta `AuditContext` (en lugar del shape custom `{ip, userAgent, traceId}`). Audit row usa `action: 'read_viewed'` (enum extendido) eliminando `payloadDiff: { subAction: 'viewed_360' }`. Controller inyecta `AuditContextFactory` y pasa `fromRequest()` — sustituye la extracción manual previa de `req.ip`/`req.headers['user-agent']`/`req.id`. |
| **FU-1.4** | `insureds.service.ts:911-928` (exportRequest) + `insureds.controller.ts` | Mantiene `action: 'export'` (sin nuevo enum value — ya estaba canónico). Controller deriva `AuditContext` del factory y propaga `ip/userAgent/traceId` al actor object que el service consume. Sustituye la extracción manual ad-hoc. |
| **FU-1.5** | `certificates.service.ts:225-241` (urlForSelf) + `certificates.controller.ts` | Sustituido `action: 'read'` + `payloadDiff: { subAction: 'downloaded' }` por `action: 'read_downloaded'` (enum extendido). Service acepta `AuditContext`; controller inyecta el factory. |
| **FU-2** | `audit-metrics-emf.ts` (NUEVO) + `audit-writer.service.ts:180-253` + `audit-chain-verifier.service.ts:40-145` | Helper EMF `emitAuditMetric(name, value)` emite log JSON estructurado en stdout (namespace `SegurAsist/Audit`, dimensión `Environment`). `AuditWriter.record()` emite `AuditWriterHealth=1` por éxito, `=0` por fallo. `AuditChainVerifierService.verify()` emite `AuditChainValid` (1/0) en cada uno de los 3 paths (db/s3/both) y `MirrorLagSeconds` (gauge segundos = lag entre última fila DB y último mirror S3) en el path `both`. Gate `NODE_ENV=test` evita pollution en jest stdout. F8 alarmas (`AuditWriterHealth`, `MirrorLagSeconds`, `AuditChainValid`) salen de INSUFFICIENT_DATA. |

### Files modificados (iter 2)

- `segurasist-api/src/modules/auth/auth.service.ts` — `otpRequest`/`otpVerify` aceptan `auditCtx?: AuditContext`; nuevos enum values + `resourceType: 'auth'`.
- `segurasist-api/src/modules/auth/auth.controller.ts` — inyecta `AuditContextFactory`, pasa `fromRequest()` a service.
- `segurasist-api/src/modules/insureds/insureds.service.ts` — `find360` acepta `AuditContext` (renombrado de `audit` → `auditCtx`), nuevo `action: 'read_viewed'`.
- `segurasist-api/src/modules/insureds/insureds.controller.ts` — inyecta `AuditContextFactory`, sustituye extracción manual.
- `segurasist-api/src/modules/certificates/certificates.service.ts` — `urlForSelf` acepta `AuditContext`, nuevo `action: 'read_downloaded'`.
- `segurasist-api/src/modules/certificates/certificates.controller.ts` — inyecta `AuditContextFactory`.
- `segurasist-api/src/modules/audit/audit-writer.service.ts` — emisión EMF `AuditWriterHealth` post-write.
- `segurasist-api/src/modules/audit/audit-chain-verifier.service.ts` — emisión EMF `AuditChainValid` + `MirrorLagSeconds` + helper `computeMirrorLagSeconds`.

### Files nuevos (iter 2)

- `segurasist-api/src/modules/audit/audit-metrics-emf.ts` — helper EMF emitter (namespace `SegurAsist/Audit`, dimensión `Environment`, gate `NODE_ENV=test` y `AUDIT_EMF_DISABLED=1`).

### Decisiones arquitectónicas iter 2

- **AuthService NO request-scoped**: cuando `AuthService` necesita `AuditContext`, lo recibe por parameter del controller en lugar de inyectar `AuditContextFactory` directamente. Inyectarlo lo volvería request-scoped (regla NestJS para deps Scope.REQUEST → upgrade automático del consumer), lo que crearía instancia + connection pool churn en cada login (5/min/IP cap = throughput esperable alto). El controller permanece default-scoped y deriva el ctx una vez por request via factory.
- **EMF format vs CloudWatch SDK PutMetricData**: EMF es zero-cost y zero-dependencia (CloudWatch Logs parsea el log JSON automático); SDK requiere credenciales runtime y agrega ~100ms latency por call. Audit es high-cardinality (cada write emite 1 metric) → EMF es el match.
- **`MirrorLagSeconds` solo en `source='both'`**: para calcular el lag necesitamos las filas de ambas fuentes — solo el path `both` ya las tiene cargadas. Emitirlo en `db` o `s3` requeriría queries adicionales que no agregan valor (el path `both` cubre el caso forensic donde el lag importa).
- **Resource type `auth` en lugar de `auth.otp.requested`**: el discriminador semántico ahora vive en `action` (`otp_requested`/`otp_verified`); `resourceType` queda como dominio (`auth`). Habilita queries como `WHERE resource_type='auth' AND action='otp_requested'` (índice compuesto) sin parsing de strings dotted.

### Cross-cutting findings iter 2

- **F1 cross-cut B4-V2-16**: F1 cerró su scope en `urlForSelf` (filtra `status='issued'` en línea 219-220) sin tocar el bloque audit (líneas 234-247). Verificado: cero conflicto con la migración audit ctx que F6 hace en líneas 234-247.
- **EMF metrics NEW-FINDING — lambda containers**: si en Sprint 5 la API se contenerea en App Runner con Lambda runtime detrás, EMF requiere que el log group tenga el `EmbeddedMetricFilter` configurado. F8 alarmas asume `/aws/apprunner/<service>/application` log group; el filter es default cuando se crea via CDK/Terraform `aws_cloudwatch_log_metric_filter` con `log_format = "JSON"`. Anotar para Sprint 5.
- **`reports-worker.service.ts` aún sin EMF**: el worker SQS también escribe audit rows via `auditWriter.record()` y se beneficia automáticamente de la emisión `AuditWriterHealth` (la metric se emite en `record()`, agnóstica al caller). NO requiere acción adicional.

## Compliance impact

- **C-10** cierra el gap de tampering coordinado del audit chain: no más ventana donde un actor con BYPASSRLS podía modificar filas pre-mirror sin detección. Junto con C-01 (PDF SHA real) cierra el dominio "integridad end-to-end" del compliance V2 sección 3.27.
- **H-01** cierra el patrón sistémico P3 (audit infra fragmentada — confirmado por 5 agentes A1+A5+A6+B5+B6). El factory + lista única + enum extendido eliminan el drift entre callers.
- **H-02** cierra el vector DoS sobre `verify-chain` (operación cara). Compliance V2 sección 3.13 (OWASP A04 Insecure Design) ↑.
- **H-24** restaura la utilidad forense del row de audit `claim.reported`: ahora lleva IP/UA/traceId → queries "claims reportados desde IP X" + correlación con CloudWatch traceId funcionan.
- **Compliance V2 estimado post-iter1+iter2**: el dominio "Auditoría" pasa de 89.4% a ~95% al cerrar este bundle + B-PDF (C-01).

## Lecciones para DEVELOPER_GUIDE.md

1. **Audit context canónico**: jamás construir `{ip, userAgent, traceId}` ad-hoc en un service que llama `auditWriter.record(...)`. Inyectar `AuditContextFactory` y `auditCtx.fromRequest()`. Los workers SQS son la única excepción legítima (no hay `req`).
2. **Hash chain verification = full SHA o nada**: cualquier verificación que solo encadene `prev_hash` sin recomputar `row_hash` desde el SHA del payload canónico es un falso positivo de seguridad. La defense-in-depth cierra cuando combinás full SHA en DB + cross-check contra S3 mirror Object Lock.
3. **Single source of truth para sensitive keys**: cualquier código que necesite redactar PII/secrets DEBE importar `SENSITIVE_LOG_KEYS` y `scrubSensitive` desde `@common/utils/scrub-sensitive`. NO duplicar listas en interceptors/loggers/services — el drift es garantizado.
4. **Enum DB extend vs sub-action en payloadDiff**: cuando un dominio nuevo aparece (OTP request, certificate download, etc.) extender el enum `AuditAction` es preferible a codificar `subAction` en `payloadDiff`. Type safety en compile-time + queries SQL eficientes (`WHERE action = 'read_downloaded'` indexable, vs scan JSON).
5. **Postgres ALTER TYPE ... ADD VALUE**: idempotente con `IF NOT EXISTS`, soporta versiones 12+ sin downtime. NO requiere `BEGIN`/`COMMIT` separado SI no se usa el nuevo valor en la misma transacción (regla técnica de PG); para extends puramente declarativos como este, una sola migration alcanza.
