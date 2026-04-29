# Developer Guide — SegurAsist (Sprint 4+)

> Guía consolidada post-auditoría exhaustiva (Sprint 3 closure → 15 Critical + ~25 High remediados) + Sprint 4 features (10 historias, 59 pts).
> **Owner**: S10 (consolidador iter 2 Sprint 4) — extiende el work F10 (Sprint 3 fixes consolidador).
> **Audiencia**: agentes de desarrollo Sprint 5 en adelante.
> **Objetivo**: que las próximas fases incidan en menos errores aprovechando el aprendizaje del audit + del dispatch Sprint 4.

---

## TL;DR ejecutivo

| Métrica | Pre-Sprint-4 | Post-Sprint-4 (iter 2 sealed) |
|---|---|---|
| 🔴 Critical bloqueantes | 15 | **0** (cerrados en Sprint 4 fixes dispatch) |
| 🟠 High bloqueantes | 57+ | **~26 cerrados** (1 nuevo en S9 iter 1: H-09 OTP unit suite); resto backlog Sprint 5 |
| Compliance V2 (33 controles) | 89.4% | **~96%** estimado post-Sprint-4 (RB-014 monthly-reports + 5 ADRs Sprint 5 prep + 159 tests Sprint 4) |
| Tests automatizados verdes | 1,094 | 1,094 + 159 Sprint 4 = **~1,253** |
| Sprint 4 historias entregadas | — | **10/10 (59 pts)**: S4-01..S4-10 con DoR ✅ y DoD ✅/❔ post-deploy |
| Façade coverage configs | 0 (eliminadas Sprint 3 closure) | **0** (mantenido) |
| ADRs documentados | 2 (ADR-0001 bypass-rls, ADR-0002 audit-context) | **7** (+ ADR-0003 SQS dedupe + ADR-0004 audit-ctx-injection + ADR-0005 packages-security-boundary + ADR-0006 alarms-cardinality + ADR-0007 coverage-thresholds) |
| Runbooks accionables | 14 (RB-001..014 SQS rename) | **15** (+ RB-014 monthly-reports-replay; RB-017 escalation + RB-018 perf-gate → backlog Sprint 5) |

**ATENCIÓN Sprint 4+ developers**: las secciones **1 (anti-patterns) y 2 (cheat-sheet)** son **lectura obligatoria antes de cualquier PR**. El audit detectó 7 patrones sistémicos repetidos por ≥3 agentes; este guide los prevé.

---

## 1. Anti-patterns confirmados en el audit (NO REPETIR)

> Cada anti-pattern lleva: evidencia Sprint 3 + fix Sprint 4 (PR/files) + regla preventiva + lección Sprint 4+.

#### 1.1 Cookie/CSRF wiring fragmentado

**Evidencia (Sprint 3)**:
- `packages/auth/src/middleware.ts:64` ejecutaba `setSessionCookies` con `sameSite='lax'` en silent-refresh (degradación CSRF).
- `apps/admin/app/api/auth/[...nextauth]/route.ts:68` el callback Cognito tenía el mismo bug.
- `apps/admin/app/api/auth/[...nextauth]/route.ts:77-86` logout vía `export const POST = GET` → ejecutable con `<img src=…>`, sin `checkOrigin`.
- 4 archivos byte-idénticos `apps/{admin,portal}/lib/{cookie-config,origin-allowlist}.ts` con drift potencial.

**Fix Sprint 4** (F7 + F2):
- Paquete nuevo `segurasist-web/packages/security/` con `cookie.ts`, `origin.ts`, `proxy.ts`. `setSessionCookies` único delegando en `setSessionCookiesForNames` que aplica `sameSite='strict'` por construcción.
- Logout migrado a `POST` exclusivo + `checkOrigin` re-aplicado en handler. `GET` retorna 405.
- Apps consumen vía re-exports delgados (`apps/{admin,portal}/lib/cookie-config.ts` → `@segurasist/security`).

**Regla preventiva**:
1. NUNCA crear `lib/cookie-config.ts` per-app — re-exportar desde `@segurasist/security/cookie`.
2. `sameSite='strict'` SIEMPRE en silent refresh y callback Cognito (sin opción de relajar).
3. Logout es POST exclusivo. GET → 405. `checkOrigin` obligatorio en handler además del middleware (defense-in-depth).
4. `secure: true` se decide por allowlist `PRODUCTION_LIKE_ENVS`, no por `NODE_ENV === 'production'` (resiste config drift como `NODE_ENV='prod'`).

**Lección Sprint 4+**: cualquier wiring que aparezca >1 vez en admin/portal es candidato a `packages/security/`. El patrón "primitivo + advanced" (`checkOrigin` simple para proxy / `checkOriginAdvanced` con webhook exemptions para middleware) evita over-coupling.

---

#### 1.2 `MessageDeduplicationId` en cola standard

**Evidencia (Sprint 3)**:
- `src/infra/aws/sqs.service.ts:17-46` aceptaba `dedupeId` y propagaba `MessageDeduplicationId` al SDK aunque las colas eran standard (AWS lo descartaba silenciosamente, sin error).
- 5 callers zombie (`batches.service.ts`, workers `insureds-creation`, `layout`, etc.) confiaban en idempotencia que jamás ocurría.

**Fix Sprint 4** (F5 + F4):
- Parámetro `dedupeId` eliminado de la firma `SqsService.sendMessage`. Refactor TS estructural; cualquier caller con cast queda detectado por test "no propagation".
- Idempotencia movida a DB-side: tabla `batch_processed_rows (tenant_id, batch_id, row_number)` con PK compuesto + `INSERT … ON CONFLICT DO NOTHING` antes de crear insured.
- Tabla `email_events` con UNIQUE parcial `(tenant_id, message_id, event_type) WHERE message_id IS NOT NULL` anti-replay SNS.
- `batch.completed` exactly-once vía `UPDATE … RETURNING` atómico + CAS sobre `completed_event_emitted_at IS NULL`.

**Regla preventiva**:
1. Colas standard NO aceptan `MessageDeduplicationId` ni `MessageGroupId` — AWS los acepta y los descarta silently. Si necesitas idempotencia, **DB-side**.
2. Patrón `(tenant_id, key UNIQUE)` para tablas `insureds/exports/batches/email_events`. La "natural key" del recurso es source of truth.
3. `UPDATE … WHERE col IS NULL` (CAS) para exactly-once events; `RETURNING` evita la ventana race de un `findFirst` posterior.
4. DLQ con `maxReceiveCount=3` mínimo; sin DLQ un mensaje envenenado bloquea o pierde la cola entera.

**Lección Sprint 4+**: tests "no propagation" valen oro. Test que verifica que un parámetro eliminado NO llega al SDK aunque el caller lo intente forzar (cast TS) es la única defensa contra zombie code.

---

#### 1.3 Audit infra fragmentada

**Evidencia (Sprint 3)**:
- 5 agentes (A1, A5, A6, B5, B6) reportaron drift entre `auditWriter.record({...})` callers — cada uno fabricaba `{ip, userAgent, traceId}` ad-hoc.
- Lista `SENSITIVE_KEYS` duplicada (12 vs 8 entries) entre `pino-config.ts` e `audit.interceptor.ts`.
- `audit-chain-verifier` solo encadenaba `prev_hash` sin recomputar SHA del payload (light path: tampering coordinado pasaba silencioso).

**Fix Sprint 4** (F6):
- `src/modules/audit/audit-context.factory.ts` (NUEVO) `@Injectable({scope: Scope.REQUEST})` único, registrado en `AuditPersistenceModule` como `@Global`.
- `src/common/utils/scrub-sensitive.ts` lista canónica única `SENSITIVE_LOG_KEYS` + alias retro-compat + `MAX_SCRUB_DEPTH=10`.
- Enum `AuditAction` extendido con `otp_requested`, `otp_verified`, `read_viewed`, `read_downloaded`, `export_downloaded` vía migration `ALTER TYPE … ADD VALUE IF NOT EXISTS`.
- `runVerification()` exportada → `verify(source='both')` recomputa SHA-256 completo del payload + cross-check DB↔S3 mirror Object Lock.

**Regla preventiva**:
1. NUNCA construir `{ip, userAgent, traceId}` ad-hoc en un service. Inyectar `AuditContextFactory` y llamar `auditCtx.fromRequest(req)`.
2. Para nueva `AuditAction`: extender enum en `prisma/schema.prisma` + migración `ADD VALUE IF NOT EXISTS`. Preferir esto a codificar `subAction` en `payloadDiff` (type-safe + queries SQL eficientes).
3. `scrubSensitive` y `SENSITIVE_LOG_KEYS` SIEMPRE importados de `@common/utils/scrub-sensitive`. Cualquier lista local es drift garantizado.
4. Verificación de hash chain = full SHA del payload o nada. Encadenar `prev_hash` sin recompute es falso positivo de seguridad.

**Lección Sprint 4+**: workers SQS son la única excepción legítima al `AuditContextFactory.fromRequest` (no hay `req`); deben llevar JSDoc inline justificando la fabricación manual + `traceId` desde SQS attributes (Sprint 5).

---

#### 1.4 Hash inconsistencia integridad

**Evidencia (Sprint 3)**:
- `src/workers/pdf-worker.service.ts:316,357` `Certificate.hash` y `qrPayload` derivaban de `randomUUID()`. El SHA real del PDF se computaba (`createHash('sha256').update(pdf).digest('hex')`) pero se descartaba (`void pdfHash;`) — solo viajaba a S3 metadata como `x-hash`.
- Resultado: el QR escaneado por terceros apuntaba a `/verify/{hash random}` → 404 garantizado.

**Fix Sprint 4** (F1 + F6):
- Refactor a **2-pass render** en `pdf-worker.service.ts`: PASS-1 con QR placeholder → buffer P1 → `realHash = SHA-256(P1)` → PASS-2 con QR apuntando a `/verify/{realHash}` → upload P2 con `Metadata: { x-hash, x-sha256-content }` → persist `Certificate { hash: realHash }`.
- F6 cierra el cross-coupling: `audit-chain-verifier` recomputa SHA full path; `Certificate.hash` ahora es input deterministic confiable para hash chain integrity downstream.

**Regla preventiva**:
1. `createHash` calculate-and-discard es un anti-pattern. Si computas un SHA, persistilo o emitilo. El comentario `void hash;` es señal de bug.
2. Cuando el contenido (QR) depende del SHA del contenedor (PDF) → render 2-pass: PASS-1 sin upload, SHA(PASS-1) = identidad, PASS-2 con upload.
3. S3 metadata `x-hash` (lookup BD) y `x-sha256-content` (SHA real del archivo en bucket) como campos separados — permite forensics off-band sin tocar BD.
4. Tests de invariantes de hash deben **recomputar** el SHA del buffer y comparar igualdad — NO `expect(hash).toMatch(/^[a-f0-9]{64}$/)` (pasa con cualquier hex random).

**Lección Sprint 4+**: dos bugs de áreas distintas (PDF hash random + portal CSP frame-src) se enmascaraban mutuamente. El dispatch de fixes debe coordinar revisión cruzada cuando un caso de uso end-to-end pasa por ≥2 bundles.

---

#### 1.5 Tests fantasma y façade coverage

**Evidencia (Sprint 3)**:
- `apps/admin/vitest.config.ts:33-77` `coverage.include` enumeraba 10 archivos manualmente — excluía silenciosamente los archivos con findings High (mobile-drawer, NextAuth catch-all, layout). Threshold 80/75/80/80 era cosmético.
- `apps/portal/lighthouserc.js:6` apuntaba a `:3001` (admin) en vez de `:3002` (portal) — gaps Performance/A11y eran ficticios.
- `test/security/cross-tenant.spec.ts` tenía 23 `it.todo` HTTP-layer.
- `packages/api-client/package.json` corría `--passWithNoTests` con 26 hooks sin tests.
- `test/e2e/setup.ts` seteaba `THROTTLE_ENABLED=false` global → enmascaraba endpoints sin `@Throttle`.

**Fix Sprint 4** (F9):
- `coverage.include` ampliado a `['app/**', 'lib/**', 'components/**']` + `exclude` granular. Threshold real 60/55/60/60 (admin/portal/BE/api-client/ui), 80/75/80/80 (packages/auth + packages/security security-critical).
- `lighthouserc.js` portal corregido a `:3002`.
- 23 `it.todo` convertidos a `describe.each(HTTP_MATRIX)` con 20 endpoints; bootstrap dinámico AppModule + Fastify.
- 50+ tests añadidos a `packages/api-client/test/*`. `--passWithNoTests` eliminado.
- `e2e/setup.ts` ahora seta `THROTTLE_ENABLED=true` + `THROTTLE_LIMIT_DEFAULT=100` + `LOGIN_THROTTLE_LIMIT=50`. Specs que requieren disable explícito hacen override puntual.

**Regla preventiva**:
1. NUNCA usar `coverage.include` selectivo enumerando archivos. Usar `include: ['app/**', 'lib/**', ...]` + `exclude` granular para layouts triviales / NextAuth catch-all / proxy passthrough.
2. `it.todo` solo si linkado a issue tracker con dueño y fecha. PR-time review rechaza `it.todo` huérfanos.
3. `--passWithNoTests` prohibido en packages con código. Si el package no tiene tests aún, agregar test stub `expect(true).toBe(true)` con TODO + issue.
4. Lighthouse / Playwright apuntan al puerto correcto: admin `:3001`, portal `:3002`.
5. Throttle en e2e: kill switch para specs específicos, NUNCA global.

**Lección Sprint 4+**: thresholds 60/55/60/60 son baseline Sprint 4. Sprint 5 escala a 70/65/70/70. Security-critical (`packages/auth`, `packages/security`) ya en 80/75/80/80; nunca se relaja.

---

#### 1.6 RLS policies drift entre migración y `policies.sql`

**Evidencia (Sprint 3)**:
- `prisma/rls/policies.sql` array `tables TEXT[]` no incluía `'exports'` ni `'system_alerts'`. Las tablas tenían `tenant_id` y migración con `ENABLE ROW LEVEL SECURITY`, pero `apply-rls.sh` re-aplicación las omitía silenciosamente.

**Fix Sprint 4** (F3):
- `'exports'` y `'system_alerts'` agregadas al array. Comentarios in-line sobre semántica de `tenant_id NULLABLE` (superadmin → `current_setting('app.current_tenant')::uuid = NULL` → false → segurasist_app jamás ve filas globales).
- `test/integration/apply-rls-idempotency.spec.ts` (NUEVO): drift check estático parsea `schema.prisma` (`@@map("X") + tenantId`) vs array `policies.sql`; bloque DB-real gateado por `RLS_E2E=1` corre `apply-rls.sh` 2 veces y verifica `pg_policies.count(*)` estable.

**Regla preventiva**:
1. TODA tabla con `tenant_id` en `prisma/schema.prisma` DEBE listarse en el array `tables TEXT[]` de `prisma/rls/policies.sql` en el MISMO PR.
2. `apply-rls.sh` debe ser idempotente y testearse en pipeline (`RLS_E2E=1` o equivalente).
3. Tests integration que requieren Postgres real se gatean por env (`RLS_E2E=1`, `OTP_FLOW_E2E=1`) y skipean graceful sin la stack. Tests estáticos (parseo del repo) corren siempre como tripwire.
4. Cross-tenant test obligatorio en `test/security/cross-tenant.spec.ts` cubriendo SELECT + INSERT + UPDATE + DELETE (la policy `FOR ALL` cubre, pero los asserts deben existir).

**Lección Sprint 4+**: el drift static-check es más barato que el DB-real check; ambos coexisten. Static falla en CI sin infra; DB-real solo en gates con LocalStack/Postgres.

---

#### 1.7 CloudWatch alarms missing

**Evidencia (Sprint 3)**:
- `envs/{dev,staging,prod}/main.tf` no invocaba el módulo `cloudwatch-alarm` para nada. Cero alarmas operacionales.
- `terraform-plan.yml` workflow referenciado en audit pero no existía en `.github/workflows/`.
- Roles IAM `tf_plan_{staging,prod}` no existían en `iam-github-oidc/main.tf` → bloqueaba GitHub Actions OIDC plan.

**Fix Sprint 4** (F8):
- `envs/{dev,staging,prod}/alarms.tf` (NUEVOS): 11 alarmas core (API ApprunnerRequests4xx/5xx, RDS CPUUtilization, SQS DLQ depth, WAF AllowedRequests anomaly, SES BounceRate, Lambda Errors, Cognito ThrottleCount) + SNS topic `oncall-p1` por env. Prod incluye SNS adicional en `us-east-1` para WAF CLOUDFRONT scope.
- `iam-github-oidc/main.tf:147-170` trust policies + 2 IAM roles `tf_plan_{staging,prod}` con `ReadOnlyAccess`.
- `main.ts:9,74-103` `SwaggerModule.setup('v1/openapi', …)` + Bearer auth → desbloquea ZAP DAST.
- Trivy job `.github/workflows/ci.yml:563-595` filesystem scan + SARIF upload.

**Regla preventiva**:
1. Cada nueva métrica custom DEBE listar el emisor cableado en el mismo PR. `INSUFFICIENT_DATA` por métrica inexistente es peor que no tener la alarma — produce ruido cognitivo.
2. WAF scope `CLOUDFRONT` obliga a SNS topic dedicado en `us-east-1` (CloudWatch Cross-Region Alarms no GA en `mx-central-1`).
3. Variables Terraform pueden declararse en el `.tf` que las consume (no centralized en `variables.tf`); preserva ownership entre agentes.
4. Trivy `ignore-unfixed` + `severity: HIGH,CRITICAL` mantiene FP < 50% (sin `ignore-unfixed` el ratio supera el umbral accionable).

**Lección Sprint 4+**: lista core 11 alarmas obligatoria por env. Custom metrics audit (`SegurAsist/Audit/AuditWriterHealth`, `MirrorLagSeconds`, `AuditChainValid`) requieren EMF emitter en `AuditWriterService` + `AuditChainVerifierService` (Sprint 5 owned by F6).

---

#### 1.8 DRY admin↔portal

**Evidencia (Sprint 3)**:
- `buildInsuredsWhere` aparecía byte-idéntico en `insureds.service.ts:list`, `insureds.service.ts:buildExportWhere` y `reports-worker.service.ts:queryInsureds`.
- Tests por orden de claves (`or[0]`, `or[3]`) detectaban rotación pero NO drift.
- `apps/{admin,portal}/lib/cookie-config.ts` y `lib/origin-allowlist.ts`: 4 archivos byte-idénticos.

**Fix Sprint 4** (F10 + F7):
- `src/modules/insureds/where-builder.ts` (NUEVO) con `buildInsuredsWhere(filter)`. 3 callers migrados: `list`, `buildExportWhere` (1-line delegator), `reports-worker.queryInsureds`. 9 specs cubren OR shape + ranges + combinaciones.
- `packages/security/{cookie,origin,proxy}.ts`. Apps reducen `lib/cookie-config.ts` a re-exports delgados que preservan APIs públicas.

**Regla preventiva**:
1. Cualquier WHERE de filtrado que aparezca en >1 site → `<resource>/where-builder.ts` shared en el módulo dueño del schema.
2. Builder shared acepta intersección laxa (`InsuredsWhereFilter` cubre `ListInsuredsQuery` y `ExportFilters`); evita acoplar al schema Zod de un caller.
3. Caller-scoped concerns (tenantId, cursor, paginación) NO van en el builder — RLS path inline; worker explicit; controller cursor decode. Builder over-abarcador se vuelve frágil.
4. Tests del builder por shape estructural (`expect.objectContaining`) NO por orden — el orden no es invariante semántico.

**Lección Sprint 4+**: el `where-builder` no captura `tenantId`; el worker (BYPASSRLS) lo añade post-build. Considerar wrapper `buildInsuredsWhereForWorker(filter, tenantId)` en Sprint 5 si el cast `as Record<string, unknown>` se vuelve común.

---

#### 1.9 `as unknown as Prisma.*WhereInput` post-migración

**Evidencia (Sprint 3)**:
- 3 casts residuales tras migración Sprint 4 que añadió `cognito_sub`:
  - `insureds.service.ts:673` `findSelf` con `as unknown as Prisma.InsuredWhereInput`.
  - `claims.service.ts:87` `createForSelf` mismo cast.
  - `certificates.service.ts:202` `urlForSelf` mismo cast.
- Los tests del módulo no detectan el cast obsoleto pero el typing sí (después de quitarlo).

**Fix Sprint 4** (F10):
- Los 3 casts eliminados. Prisma client ya tipa `cognitoSub` correctamente.
- `certificates.service.ts` además removí el `import type { Prisma }` que quedó unused.

**Regla preventiva**:
1. Tras cada migración Prisma que añade un campo, grep `as unknown as Prisma\.` en módulos que tocan los modelos afectados y eliminar.
2. El cast escondía typos potenciales y bloqueaba el `--strict` checking del field. Removerlo es una mejora de typing (no funcional).
3. Hook pre-merge sugerido (Sprint 5): script que detecta cast `as unknown as Prisma.<X>WhereInput` y warn.

**Lección Sprint 4+**: deuda residual TS no aparece como issue P1, pero erosiona la utilidad del strict typing. Cada migración debe tener un "cast cleanup pass" en el PR.

---

#### 1.10 `PrismaBypassRlsService` sin guard runtime

**Evidencia (Sprint 3)**:
- 16 callers inyectaban el service. El `RolesGuard` lo cubría a nivel HTTP, pero cualquier regresión en el guard dejaba el bypass expuesto.

**Fix Sprint 4** (F10, ADR-0001):
- `src/common/guards/assert-platform-admin.ts` (NUEVO) helper runtime + spec 8 cases.
- Aplicado en `buildScope`/`toCtx` de: `tenants`, `users`, `insureds`, `packages`, `coverages`, `batches`, `audit`, `reports`, `certificates` controllers.
- Workers application-scoped (sin `req.user`) explícitamente OUT-of-scope, documentados en ADR-0001 con justificación + tenantId explícito en cada query.

**Regla preventiva**:
1. Cualquier endpoint HTTP que rutea a un service usando `PrismaBypassRlsService` DEBE invocar `assertPlatformAdmin(req.user)` en `buildScope`/`toCtx`.
2. Workers (sin `req`) están exentos pero deben tener JSDoc justificando bypass + filtro `tenantId` explícito en cada query.
3. `AuthService.findInsuredByCurp` también usa bypass (lookup pre-auth) — protegido por throttle + IP allowlist (documentado en ADR-0001).
4. ADR-0001 enumera 4 alternativas rechazadas con razón; cualquier propuesta de cambio debe ser ADR successor.

**Lección Sprint 4+**: defense-in-depth runtime ≠ defense-in-redundancy. El guard HTTP ya cubre, pero un check runtime garantiza fail-closed si el guard se desconfigura.

---

#### 1.11 Identity claims faltantes en cognito-local seed

**Evidencia (Sprint 3)**:
- `scripts/cognito-local-bootstrap.sh` `ensure_user` creaba el insured demo sin `given_name` claim → portal caía a fallback "insured.demo" derivado del email local-part en lugar de "Hola, María".

**Fix Sprint 4** (F10):
- `ensure_user` ahora acepta variadic args 6/7 (`given_name`, `family_name`).
- Insured demo bootstrapped con "María" / "Hernández" coincidiendo con `seed.ts`.

**Regla preventiva**:
1. Cuando un agente añade un claim al JWT que el FE consume (greeting, avatar, theme, role-derived UI), DEBE sincronizar `cognito-local-bootstrap.sh` en el mismo PR.
2. Cognito real (AWS) ya tiene los standard attributes habilitados; el bootstrap local debe explícitamente popularlos para que el dev-loop espeje prod.
3. PR review: si tocas algún `useToken*` hook o `decodeJwt(...).<claim>`, ¿el bootstrap genera ese claim?

**Lección Sprint 4+**: los fallbacks "ergonómicos" (derivar nombre del email) ocultan bugs de bootstrap. Preferir error visible ("nombre faltante en JWT") en dev a fallback silencioso.

---

#### 1.12 EventBridge cron + AWS UTC-only TZ

**Evidencia (Sprint 4 — S3 NEW-FINDING TZ)**:
- `aws_cloudwatch_event_rule.schedule_expression` solo soporta UTC. Producto pidió "9 AM CST" (08:00 América/México_City) para envío fin de mes; el cron `cron(0 14 1 * ? *)` corre a 14:00 UTC = 08:00 CST en horario sin DST.
- México eliminó DST en 2022 → no hay drift estacional. Pero AWS NO valida TZ ni warns en plan/apply; la rule queda silenciosamente off-by-1h si el operador asume "9 AM" sin convertir.

**Fix Sprint 4** (S3):
- Comentario explícito en `eventbridge-rule/main.tf` documentando UTC + ejemplo CST.
- README del módulo enumera tabla TZ → cron expression (`08:00 CST = cron(0 14 ...)`).
- Migración planeada Sprint 5: `aws_scheduler_schedule` (recurso EventBridge Scheduler v2) que soporta `schedule_expression_timezone = "America/Mexico_City"`.

**Regla preventiva**:
1. **TODA expresión cron en EventBridge documenta UTC + zona pretendida + offset** en el comentario de la línea HCL.
2. **Wall-clock confirmado con PO** ANTES del PR — preguntar "¿9 AM CST significa 9 AM en mi computadora o 9 AM en CDMX siempre?" evita drift cuando hay viajes/usuarios remotos.
3. **`aws_scheduler_schedule` para crons "with timezone semantics"** Sprint 5+; mantener `aws_cloudwatch_event_rule` solo para event-pattern (no schedule).
4. **Si producto requiere "1er día hábil del mes"** (no calendar-day-1), Lambda handler debe verificar `isWeekend(today) || isHoliday(today)` y `event.deferredReason='non-business-day'` → noop dejando que el cron del día siguiente actúe (cron AWS no soporta "1st business day" nativamente).

**Lección Sprint 4+**: TZ como anti-pattern silencioso. AWS deliberadamente no valida ni alerta sobre intent vs execution; el costo es 1 hora desfasada en producción durante meses si no hay alarma fina.

---

#### 1.13 SES SDK v3 sin attachments

**Evidencia (Sprint 4 — S3 NEW-FINDING email-attachments)**:
- `SendEmailCommand` de `@aws-sdk/client-ses` (SDK v3) NO soporta attachments — solo body HTML + plain text + Tags.
- Para attachments hay que usar `SendRawEmailCommand` con MIME multipart construido a mano (boundary, base64 encoding del binario).
- Sprint 4 cron mensual asumió default "send PDF como attachment"; refactor mid-sprint a "link presigned 7d en S3" reusando patrón email-worker certificates.

**Fix Sprint 4** (S3):
- MVP cron envía email body con link presigned (7d TTL) hacia `s3://bucket/reports/{tenant}/{period}.pdf`.
- Backlog Sprint 5: si producto requiere attachment, implementar `MailRawSenderService` con `SendRawEmailCommand` + MIME builder + tests round-trip de parse.

**Regla preventiva**:
1. **`SendEmailCommand` para emails simples (body + Tags); `SendRawEmailCommand` cuando attachments**. Documentar en JSDoc del service.
2. **Link presigned 7d en S3 como default Sprint 4-5** — evita complejidad MIME + reduce payload SES (rate limit por bytes/min). Ver patrón en `email-worker.service.ts` certificates.
3. **Tags SES siempre** (`tenant_id`, `email_type`) — `SendEmailCommand` y `SendRawEmailCommand` ambos soportan; CloudWatch dimensions activan filtros por tenant en bounce/complaint.

**Lección Sprint 4+**: leer signature SDK v3 ANTES de prometer feature al PO. SDK docs cambian entre v2/v3; v2 sí soportaba attachments en `SendEmailCommand`.

---

#### 1.14 EMF emitter `Environment` dimension mismatch con alarms

**Evidencia (Sprint 4 — S9 NEW-FINDING audit-metrics-emf)**:
- `audit-metrics-emf.ts` emite con dimension `Environment = process.env.NODE_ENV ?? 'unknown'` → valores `development` / `test` / `staging` / `production` / `unknown`.
- Alarmas en `alarms.tf` filtran `Environment = var.environment` con valores `dev` / `staging` / `prod`.
- **Resultado**: alarmas SegurAsist/Audit (`AuditWriterHealth`, `MirrorLagSeconds`, `AuditChainValid`) en estado `INSUFFICIENT_DATA` permanente en dev y prod aunque el emisor esté funcionando. Staging matchea por casualidad (NODE_ENV=staging y var.environment=staging).
- Daño: monitoreo audit silenciado durante meses; escalación P1 ante tampering NO se activa.

**Fix Sprint 4** (deferral Sprint 5 — S9 documentó en ADR-0006 §Decision punto 6):
- **Opción A (preferida, 1 LOC)**: emitter usa `process.env.APP_ENV ?? process.env.NODE_ENV ?? 'unknown'`. App Runner Terraform setea `APP_ENV=dev|staging|prod` en `environment_variables`.
- **Opción B**: alarmas filtran con condicional terraform (feo, zero-code en src).

**Regla preventiva**:
1. **Tests integration EMF↔alarms en CI** — `metrics-alarms-alignment.spec.ts` levanta CloudWatch local (LocalStack) + emite métrica con dimension del emitter + verifica que alarma con dimension del IaC matches.
2. **Una variable única `APP_ENV` para tag/dim cross-componente** — no `NODE_ENV` (semántica node "production minified") ni `var.environment` (Terraform-only).
3. **PR review checklist**: si tocas un EMF emitter, ¿la dimension matchea exactamente la alarma? Mostrar `aws cloudwatch describe-alarms --alarm-names X` output al revisor.
4. **Alarm metric data review** post-merge a staging: ver primera medición + confirmar transition `INSUFFICIENT_DATA → OK/ALARM`. Si stuck en INSUFFICIENT_DATA → mismatch latente.

**Lección Sprint 4+**: la mejor alarma es la que se prueba con datos reales. Custom metrics requieren end-to-end test contra CloudWatch real (LocalStack en CI; AWS real en deployment smoke).

---

#### 1.15 Coordinación cross-bundle: schemas evolutivos sin contract-first

**Evidencia (Sprint 4 — S2 NEW-FINDING shapes-realineadas + S4 NEW-FINDING chatbot-shape)**:
- S2 (FE reports) inició iter 1 antes de que S1 (BE reports) publicara DTOs definitivos. Resultado: realineación midstream:
  - `ConciliacionReportResponse` resultó objeto agregado, no `rows[]` — UI rediseñada como stats grid.
  - `UtilizacionRow` campos `usageCount/usageAmount` (no `used/limit/utilizationPct`).
  - Filter `tenantId` (platformAdmin) en lugar de `entityId`.
- S4 (FE chatbot) tipó `ChatMessageReply` con `[extra: unknown]` index signature como bridge contra refinamientos S5/S6 iter 2 — escapó al desacople pero a costa de typing fuerte FE.

**Fix Sprint 4** (mid-sprint):
- S1 publica feed entries `iter1 DONE shape <DTO>` ANTES de los integration tests con shape estabilizado.
- S2 espera el feed BE-DONE para shapes complejas (objetos con campos opcionales, agregados); para filtros simples (qs strings) no espera.

**Regla preventiva**:
1. **BE owners publican feed `iter1 SHAPE-FROZEN <DTO> <path>`** apenas el DTO Zod compila — esto es el contract-first ligero del monorepo.
2. **FE owners de bundles cross-FE/BE wait-list** los `SHAPE-FROZEN` antes de empezar UI compleja; pueden trabajar diseño/skeletons en paralelo.
3. **Shape evolution intencional** (`[extra: unknown]` + opcionales): documentado con `// TODO BE-iter2: refinar` + issue tracker; no es default.
4. **Tests api-client deben usar fixtures derivadas del Zod schema** (`generateMock(ZodSchema)` con `@anatine/zod-mock` o equivalente) — NO objetos hand-crafted divergentes.

**Lección Sprint 4+**: en sprints multi-agente, contract-first = feed-driven shape-freeze. No hay tooling formal (OpenAPI codegen pre-PR es Sprint 5+ backlog); el feed es el contrato.

---

#### 1.16 Modelos pre-existentes con columnas TODO: extender > duplicar

**Evidencia (Sprint 4 — S5 NEW-FINDING schema.prisma)**:
- `ChatMessage` y `ChatKb` existían en schema desde Sprint 1 como stubs (campos básicos sin keywords/synonyms/priority/enabled/conversationId).
- Tentación: crear `KnowledgeBaseEntry` y `ChatConversation` paralelos. RECHAZADO — duplicación de tablas con la misma semántica + dolor de migración futura.
- Solución: extender los modelos existentes con `ADD COLUMN IF NOT EXISTS` + cohabitar datos Sprint 1 con campos Sprint 4 (NULL aceptado para Sprint 1 rows).

**Fix Sprint 4** (S5):
- Migración `20260427_chatbot_kb` con `ADD COLUMN IF NOT EXISTS` para 4+ columnas en `ChatKb` y 3 columnas en `ChatMessage`.
- `prisma/schema.prisma` extendido con campos opcionales (`keywords String[] @default([])`, etc.).
- Stubs Sprint 1 funcionan sin cambios; queries Sprint 4 manejan NULL/empty.

**Regla preventiva**:
1. **Antes de crear `model Foo` nuevo, grep `ChatKb`/`Message`/equivalente en schema** — extender es siempre preferible a duplicar.
2. **`ADD COLUMN IF NOT EXISTS`** + `DEFAULT` o `NULL` permitido → migración idempotente y backward-compat con datos viejos.
3. **JSdoc en el modelo** documenta cuándo se introdujo cada campo (`/** @since Sprint 4 — keywords/synonyms matching */`).
4. **`ls` del path NEW antes de escribir**: en sprints multi-agente, otro agente puede haber tocado el archivo; lectura previa evita conflictos sutiles (caso S5/S6 escalation.service).

**Lección Sprint 4+**: schema.prisma es estructuralmente shared (sección lock implícito por modelo); cada agente toca solo su modelo. Pero al CREAR un modelo nuevo que solapa con un stub existente, la responsabilidad es revisar Y extender.

---

## 2. Patrones a seguir (CHEAT-SHEET)

> Snippets copy-paste-ready. Imports concretos. Cada bloque ≤6 líneas efectivas.

#### 2.1 Adding a new endpoint

```ts
// 1. DTO Zod
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
export class CreateFooDto extends createZodDto(z.object({ name: z.string().min(1) })) {}

// 2. Controller con RBAC + Throttle si público
@Controller('v1/foos')
export class FoosController {
  @Post() @Roles('admin_segurasist') @Throttle({ ttl: 60_000, limit: 30 })
  async create(@Req() req: FastifyRequest, @Body() dto: CreateFooDto) {
    return this.svc.create(dto, this.auditCtx.fromRequest(req));
  }
}

// 3. Service: inyectar AuditContextFactory + auditWriter.record con ctx.
// 4. Spec integration con stack real (testcontainers o docker-compose `test`).
// 5. Coverage: include automático por glob — NO usar `coverage.include` selectivo.
```

Bullets accionables:
- **Si `@Public()`**: SIEMPRE `@Throttle()` (cap referenciar /login = 5/min, /refresh = 10/min, /otp = 5/min).
- **DTO**: Zod con `@nestjs/zod` (registry global) — NO class-validator manual a menos que mixed-validation sea inevitable.
- **Audit**: `auditCtx.fromRequest(req)` siempre. NUNCA fabricar `{ip, userAgent, traceId}` ad-hoc.
- **Tests**: spec integration mínimo + cross-tenant entry en `test/security/cross-tenant.spec.ts:HTTP_MATRIX`.

#### 2.2 Adding a new SQS worker

```ts
// 1. ENV var en env.schema.ts
SQS_QUEUE_NEW_FEATURE: z.string().url(),

// 2. Worker (idempotencia DB-side, NO dedupeId)
@SqsMessageHandler('new-feature')
async handle(@Message() msg: NewFeatureMsg) {
  await this.prisma.$executeRaw`INSERT INTO new_feature_processed (tenant_id, key)
    VALUES (${msg.tenantId}::uuid, ${msg.key}) ON CONFLICT DO NOTHING`;
  // ... resto
}

// 3. Sqs send (sin dedupeId, sin messageGroupId)
await this.sqs.sendMessage(env.SQS_QUEUE_NEW_FEATURE, payload);
```

Bullets accionables:
- **Cola standard SIN** `MessageDeduplicationId` ni `MessageGroupId`.
- **UNIQUE** constraint con la natural key (`tenant_id, entity_id, op_type` o equivalente).
- **localstack-bootstrap.sh + 3 envs Terraform `main.tf`**: declarar la cola + DLQ + redrive `maxReceiveCount=3`.
- **CloudWatch alarm**: DLQ depth > 0 en `envs/{env}/alarms.tf`.
- **NO** fabricar URL de cola via `String.replace` — siempre desde ENV.

#### 2.3 Adding a new RLS-protected table

```sql
-- prisma/migrations/<DATE>_<table>/migration.sql
ALTER TABLE foos ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_foos_select ON foos FOR SELECT USING (tenant_id::text = current_setting('app.current_tenant', true));
CREATE POLICY p_foos_modify ON foos FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));
```

```sql
-- prisma/rls/policies.sql array (OBLIGATORIO en mismo PR)
tables TEXT[] := ARRAY[..., 'foos'];
```

Bullets accionables:
- Test integration `apply-rls-idempotency.spec.ts` actualiza el set esperado (drift static check).
- Test cross-tenant en `test/security/cross-tenant.spec.ts` cubre SELECT + INSERT + UPDATE + DELETE.
- `tenant_id NULLABLE` (como `users` o `system_alerts`): documentar inline el comportamiento `NULL = NULL → false`.

#### 2.4 Adding a new frontend route (admin/portal)

```ts
// apps/portal/app/api/foo/route.ts
import { PORTAL_SESSION_COOKIE } from '@/lib/cookie-names';
import { checkOrigin } from '@/lib/origin-allowlist'; // re-export de @segurasist/security
// ... y para proxy:
import { makeProxyHandler } from '@segurasist/security/proxy';
export const POST = makeProxyHandler({
  cookieName: PORTAL_SESSION_COOKIE,
  originAllowlist: ['https://portal.segurasist.com'],
  apiBase: process.env.API_BASE_URL!,
});
```

Bullets accionables:
- **Cookie config + origin allowlist**: SIEMPRE desde `packages/security` via re-export del `lib/`. NUNCA duplicar.
- **CSP `frame-src`**: ajustar en `next.config.mjs` si embed iframes (`'self' https://*.s3.<region>.amazonaws.com https://*.cloudfront.net`).
- **Cookie portal vs admin**: `PORTAL_SESSION_COOKIE` (`sa_session_portal`) ≠ `SESSION_COOKIE` (`sa_session`). Importar siempre del path correcto.
- **Logout**: POST exclusivo + `checkOrigin`. GET → 405.

#### 2.5 Adding a new audit action

```prisma
// prisma/schema.prisma
enum AuditAction { ... otp_verified read_downloaded export_downloaded new_action }
```

```sql
-- prisma/migrations/<DATE>_audit_action_new_action/migration.sql
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'new_action';
```

```ts
// service
async doSomething(req: FastifyRequest, dto: Dto) {
  const ctx = this.auditCtx.fromRequest(req);
  await this.auditWriter.record({ action: 'new_action', ctx, payloadDiff: scrubSensitive(dto) });
}
```

Bullets accionables:
- **Enum extend > subAction en payloadDiff**: type-safe + queries SQL eficientes (`WHERE action = 'X'` indexable).
- **`scrubSensitive(payload)`** antes de persistir. NUNCA inline `delete payload.password`.
- **Test integration** `audit-action-<name>.spec.ts` con tampering scenario (mutar `payloadDiff` post-write y verificar que `verify-chain` lo detecta).

---

#### 2.6 Adding a new chart/report (Sprint 4 — S1 + S2)

> _Aplica a S4-01..03 (conciliación / volumetría / utilización) y futuros reportes (S5+)._

```ts
// 1. DTO Zod compartido + @ApiProperty para Swagger.
// segurasist-api/src/modules/reports/dto/conciliacion-report.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
export const ConciliacionQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM cerrado
  tenantId: z.string().uuid().optional(),    // sólo platformAdmin
  format: z.enum(['json', 'pdf', 'xlsx']).default('json'),
});
export class ConciliacionQueryDto extends createZodDto(ConciliacionQuerySchema) {}
```

```ts
// 2. Service: query optimizada (CTE/subquery) — UNA SQL, no N+1.
// reports.service.ts
async conciliacion(scope: ReportsScope, q: ConciliacionQueryDto) {
  const sql = Prisma.sql`
    WITH altas AS (
      SELECT COUNT(*)::int AS n FROM insureds
       WHERE tenant_id = ${scope.tenantId}::uuid
         AND created_at >= date_trunc('month', ${q.period}::date)
         AND created_at <  date_trunc('month', ${q.period}::date) + interval '1 month'
    ), bajas AS ( ... ), activos AS ( ... )
    SELECT (SELECT n FROM altas) AS altas,
           (SELECT n FROM bajas) AS bajas,
           (SELECT n FROM activos) AS activos_cierre`;
  const [row] = await this.prisma.$queryRaw<Array<...>>(sql);
  return row;
}
```

```ts
// 3. Controller: PDF reusa workers/pdf-worker pattern; XLSX via exceljs.
@Get('conciliation/download')
@Roles('admin_segurasist', 'admin_mac', 'supervisor')
async download(@Query() q: ConciliacionQueryDto, @Req() req: FastifyRequest) {
  const data = await this.svc.conciliacion(this.buildScope(req, q.tenantId), q);
  if (q.format === 'pdf') {
    const buf = await this.pdfRenderer.render('conciliacion', data); // 2-pass NO, single-pass OK (sin QR cíclico)
    return { contentType: 'application/pdf', body: buf };
  }
  if (q.format === 'xlsx') {
    const buf = await this.xlsxRenderer.render('conciliacion', data); // exceljs Workbook
    return { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: buf };
  }
  return data; // json default
}
```

```ts
// 4. Frontend: hook tanstack-query + chart en packages/ui.
// segurasist-web/packages/api-client/src/hooks/reports.ts
export function useConciliacion(period: string) {
  return useQuery({
    queryKey: ['reports', 'conciliacion', period],
    queryFn: () => apiClient.get(`/v1/reports/conciliation?period=${period}`),
    staleTime: 5 * 60_000, // 5 min — period cerrado, no cambia
  });
}
```

```tsx
// 5. Chart: import desde packages/ui (NO duplicar en apps).
// segurasist-web/packages/ui/src/components/charts/LineTrendChart.tsx
import { LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
export function LineTrendChart({ data }: { data: { date: string; count: number }[] }) {
  return (<LineChart data={data} width={600} height={300}>
    <XAxis dataKey="date" /><YAxis /><Tooltip /><Line dataKey="count" />
  </LineChart>);
}
```

Bullets accionables:
- **PDF**: reusa `reports-pdf-renderer.service.ts` (S1). Sin QR cíclico → single-pass está bien (vs. F1 §1.4 cert PDF requiere 2-pass).
- **XLSX**: `exceljs` (no `xlsx` lib — vulnerabilidades CVE-2023-30533). `Workbook → Worksheet → addRow`. Test con `read(buf)` round-trip.
- **Query optimizada**: CTE compuesta o subquery escalar agrupa altas/bajas/activos en una sola roundtrip; evitar N+1 (regresión típica si se hace `for tenant in tenants: count()`).
- **Cache strategy**: períodos cerrados (mes pasado) son idempotentes — `staleTime: 5min` en TanStack. Períodos abiertos (mes en curso) → `staleTime: 0` o `refetchInterval`.
- **Cross-tenant cuidado**: `admin_segurasist` con `tenantId` query param ⇒ `assertPlatformAdmin(req.user)` + `PrismaBypassRlsService`. Si NO platformAdmin, ignorar `tenantId` (no return 400 — silencioso defense-in-depth).
- **Coverage**: añadir test `reports.service.spec.ts` con fixture mes cerrado + assert cifras exactas (no `expect.any(Number)`).
- **Performance gate**: render `<3 s` (TC-602 MVP_07). Si query toma más, agregar índice compuesto `(tenant_id, created_at)` partial.

#### 2.7 Adding a new chatbot KB entry (Sprint 4 — S5 + S6)

> _Aplica a S4-06 KB matching y S4-07 personalización._

```prisma
// prisma/schema.prisma
model KnowledgeBaseEntry {
  id              String   @id @default(uuid())
  tenantId        String   @map("tenant_id")
  category        String   // 'vigencia' | 'coberturas' | 'siniestros' | 'pagos' | 'contacto'
  question        String
  keywords        String[] // ['vigencia', 'hasta cuando', 'expira']
  synonyms        String[] // ['plazo', 'duración', 'validez']
  answerTemplate  String   @map("answer_template") // soporta placeholders {{insured.firstName}} {{policy.validTo}}
  active          Boolean  @default(true)
  priority        Int      @default(0) // tie-breaker matching
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  tenant          Tenant   @relation(fields: [tenantId], references: [id])
  @@index([tenantId, category, active])
  @@map("kb_entries")
}
```

```sql
-- migrations/<DATE>_chatbot_kb/migration.sql
ALTER TABLE kb_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_kb_select ON kb_entries FOR SELECT
  USING (tenant_id::text = current_setting('app.current_tenant', true));
CREATE POLICY p_kb_modify ON kb_entries FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));
```

```sql
-- prisma/rls/policies.sql array (OBLIGATORIO mismo PR)
tables TEXT[] := ARRAY[..., 'kb_entries'];
```

```ts
// 2. Matching engine (S5): keywords + synonyms + tokenize + score.
// chatbot/kb.service.ts
async match(tenantId: string, text: string): Promise<KbMatch | null> {
  const tokens = tokenizeES(text); // lowercase + diacritics-strip + split
  const candidates = await this.prisma.knowledgeBaseEntry.findMany({
    where: { tenantId, active: true },
  });
  // RLS no aplica acá si usamos Prisma con tenant context; bypass = explicit tenantId.
  const scored = candidates.map((kb) => ({
    kb,
    score: scoreMatch(tokens, [...kb.keywords, ...kb.synonyms]),
  }));
  scored.sort((a, b) => b.score - a.score || b.kb.priority - a.kb.priority);
  return scored[0]?.score >= MATCH_THRESHOLD ? scored[0] : null;
}
```

```ts
// 3. Personalization (S6): placeholders documentados.
// chatbot/personalization.service.ts
const PLACEHOLDERS_DOC = {
  '{{insured.firstName}}': 'Nombre del asegurado autenticado (de JWT given_name claim).',
  '{{insured.fullName}}': 'Nombre completo (given_name + family_name).',
  '{{policy.validTo}}': 'Fecha vigencia formateada es-MX (DD de MMMM de YYYY).',
  '{{policy.packageName}}': 'Nombre del paquete activo del asegurado.',
  '{{coverage.<key>.consumed}}': 'Cantidad consumida de la cobertura por key.',
  '{{coverage.<key>.total}}': 'Total disponible de la cobertura.',
  '{{tenant.contactPhone}}': 'Teléfono soporte del tenant (call-to-action).',
};
async render(template: string, ctx: InsuredContext): Promise<string> {
  // Reemplazo seguro: nunca eval. Whitelist de placeholders. Locale es-MX.
  return template.replace(/{{(insured|policy|coverage|tenant)\.[^}]+}}/g, (match) => {
    return resolvePlaceholder(match, ctx) ?? match;
  });
}
```

```ts
// 4. Cross-tenant test obligatorio (anti-pattern §1.6).
// test/integration/chatbot-kb.spec.ts
it('insured tenant A no recibe KB entry tenant B', async () => {
  await prismaBypass.knowledgeBaseEntry.createMany({
    data: [
      { tenantId: TENANT_A, category: 'vigencia', question: 'A', keywords: ['plan'], answerTemplate: 'A-only', active: true },
      { tenantId: TENANT_B, category: 'vigencia', question: 'B', keywords: ['plan'], answerTemplate: 'B-only', active: true },
    ],
  });
  const res = await chatbot.match(TENANT_A, 'plan');
  expect(res?.kb.tenantId).toBe(TENANT_A);
  expect(res?.kb.answerTemplate).not.toContain('B-only');
});
```

Bullets accionables:
- **Modelo KB único + multi-tenant**: NO un schema por tenant. `tenant_id` discriminator + RLS hace el split automático.
- **Tokenización es-MX**: lowercase, strip diacritics (`á→a`), split en boundaries (`\W`). Implementar como utility shared `chatbot/tokenize.ts` para reusar en match + admin search.
- **Whitelist de placeholders**: regex con grupos namedeados; NUNCA `eval` o template-engine genérico (XSS risk si admin-CRUD escapa caracteres mal). Para faltantes, dejar el placeholder literal (no exponer error técnico al insured).
- **Threshold matching**: empezar con 0.5 (score normalizado 0..1); calibrar con dataset real Sprint 5. Por debajo del threshold ⇒ fallback con sugerencias O escalar (TC-503).
- **Audit log**: cada `chatbot.message` registrarlo con `auditCtx.fromRequest(req)` + acción `chatbot_message_sent`. Personalización exitosa NO loggea PII (solo `intent`, `kbEntryId`, `responseLengthChars`); el `payloadDiff` debe ir scrubbed.
- **Privacy**: el `text` del usuario es PII ligero (puede contener nombre, fecha nacimiento). Persistirlo en `chat_messages` con retention 30d (`MVP_02 §F5`); `scrubSensitive` aplicado antes de loggear.
- **Cross-tenant test obligatorio**: 2 tenants con KB con misma keyword, asegurado A solo ve la suya. Suite bloqueante en CI.
- **Admin CRUD**: `@Roles('admin_segurasist', 'admin_mac')` + UI shadcn admin/kb-management. Cambios deben reflejarse en portal en ≤5 min (TC-506) — invalidar cache TanStack o no cachear con `staleTime: 0` para KB matching.

#### 2.8 Adding an EventBridge cron (Sprint 4 — S3)

> _Aplica a S4-04 (envío automático fin de mes) y futuros crons (limpieza retention, refresh dashboards)._

```hcl
# segurasist-infra/modules/eventbridge-rule/main.tf
variable "name"                  { type = string }
variable "schedule_expression"   { type = string } # ej. "cron(0 9 1 * ? *)" — día 1 9 AM UTC
variable "target_arn"            { type = string }
variable "input_payload"         { type = map(string), default = {} }
variable "alarm_sns_topic_arn"   { type = string }

resource "aws_cloudwatch_event_rule" "rule" {
  name                = var.name
  schedule_expression = var.schedule_expression
}
resource "aws_cloudwatch_event_target" "target" {
  rule  = aws_cloudwatch_event_rule.rule.name
  arn   = var.target_arn
  input = jsonencode(var.input_payload)
}
resource "aws_cloudwatch_metric_alarm" "failed_invocations" {
  alarm_name          = "${var.name}-failed-invocations"
  metric_name         = "FailedInvocations"
  namespace           = "AWS/Events"
  statistic           = "Sum"
  threshold           = 1
  evaluation_periods  = 1
  period              = 300
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions          = { RuleName = aws_cloudwatch_event_rule.rule.name }
  alarm_actions       = [var.alarm_sns_topic_arn]
}
```

```ts
// 2. Idempotencia DB-side. NO confiar en EventBridge "exactly-once" — puede haber re-invocations.
// reports-worker.service.ts → handleMonthlyConciliation
@SqsMessageHandler('monthly-reports')
async handle(@Message() msg: { period: string; tenantId: string; runId: string }) {
  // UNIQUE (tenant_id, period) en tabla `report_runs` evita doble-render.
  await this.prisma.$executeRaw`
    INSERT INTO report_runs (id, tenant_id, period, status, created_at)
    VALUES (${msg.runId}::uuid, ${msg.tenantId}::uuid, ${msg.period}, 'processing', now())
    ON CONFLICT (tenant_id, period) DO NOTHING
    RETURNING id`;
  // Si el INSERT no insertó (período ya procesado), early-return.
  // Si insertó, generar PDF + XLSX + email a destinatarios + UPDATE status='done'.
}
```

```ts
// 3. Lambda handler stub (si se decide Lambda en lugar de SQS-message-from-EventBridge).
// src/lambdas/monthly-reports/handler.ts
export const handler: ScheduledHandler = async (event) => {
  const period = computePeriod(event.time);  // 'YYYY-MM' del mes anterior
  const tenants = await prisma.tenant.findMany({ where: { active: true }, select: { id: true } });
  // Fan-out: 1 mensaje SQS por tenant (parallelizable, mantiene idempotencia).
  for (const t of tenants) {
    await sqs.sendMessage(env.SQS_QUEUE_MONTHLY_REPORTS, {
      tenantId: t.id, period, runId: randomUUID(),
    });
  }
};
```

```hcl
# 4. Wire-up en envs/{env}/main.tf
module "monthly_reports_cron" {
  source              = "../../modules/eventbridge-rule"
  name                = "${var.env}-monthly-reports"
  schedule_expression = "cron(0 9 1 * ? *)" # 1ro del mes 9 AM UTC = 3 AM CDMX
  target_arn          = aws_lambda_function.monthly_reports.arn
  input_payload       = { source = "scheduled-monthly-reports" }
  alarm_sns_topic_arn = aws_sns_topic.oncall_p1.arn
}
```

Bullets accionables:
- **Idempotencia DB-side OBLIGATORIA**: EventBridge garantiza "at-least-once", no "exactly-once". Re-invocations ocurren en transient errors → UNIQUE `(tenant_id, period)` + `INSERT … ON CONFLICT DO NOTHING` es el contrato.
- **Cron expressions UTC, no local**: `cron(0 9 1 * ? *)` = 9 AM UTC = 3 AM CDMX. Confirmar con PO + equipo MAC el wall-clock target. Ajustar offset si UAT lo pide.
- **Día hábil 1**: cron AWS no soporta nativamente "1er día hábil". Lambda handler debe verificar `isWeekend(today) || isHoliday(today)` y `event.deferredReason='non-business-day'` → noop + dejar al cron del siguiente día actuar. Tabla `mx_holidays` curada por DevOps + admin.
- **Fan-out SQS-from-Lambda**: mejor que single Lambda invocation para todos los tenants (timeout limit + observability). Cada tenant un mensaje SQS → parallelizable + DLQ por mensaje.
- **CloudWatch alarm `FailedInvocations`**: dimensión `RuleName` SIEMPRE. Sin alarma, un cron silencioso roto pasa 1 mes sin detección. SLA: pager ≤5 min (RB-019 nuevo Sprint 4).
- **Test integration**: `eventbridge-cron.spec.ts` valida idempotencia DB-side (insertar 2 veces, verificar 1 sola row). Test "real" del cron en LocalStack EventBridge requiere `LOCALSTACK_E2E=1` gate.
- **Email destinatarios**: lista por tenant en `tenant.report_recipients` (jsonb). NO env var (no escala multi-tenant). SES `Tags: [{Name: 'tenant_id', Value: tenantId}, {Name: 'email_type', Value: 'monthly-report'}]` para CloudWatch dimensions (F3 H-11).
- **Versionado**: cuando cambia el formato del reporte, NO sobrescribir runs históricos. Crear `report_runs.version` y permitir re-render con `?version=2025-04` query param.

---

## 3. Setup local-dev rápido (referencia rápida)

> _F8 + F10 verifican y actualizan post-merge multi-agent_

```bash
# 0. Post-merge cleanup (CRÍTICO tras pulls que toquen packages/security/, lib/cookie-names.ts o api-client deps)
rm -rf segurasist-web/apps/portal/.next segurasist-web/apps/admin/.next
pnpm install   # F7 dejó symlinks manuales; F9 declaró devDeps en api-client → install regenera lockfile

# 1. Servicios (LocalStack + Postgres + Redis + Mailpit + cognito-local)
cd segurasist-api
./scripts/dev-up.sh

# 2. Bootstrap (RLS + seed + Cognito users)
pnpm migrate:dev
pnpm seed
./scripts/cognito-local-bootstrap.sh   # incluye given_name/family_name post-F10
./scripts/localstack-bootstrap.sh      # 5 colas (layout, insureds-creation, pdf, emails, reports)

# 3. Run
pnpm start:dev          # API :3000
cd ../segurasist-web
pnpm --filter admin dev   # :3001
pnpm --filter portal dev  # :3002

# 4. Suite completa post-fixes (validation gate D4)
cd segurasist-api
pnpm test:unit
pnpm test:integration -- cross-tenant bypass-rls export-rate audit-tampering cert-integrity sqs-dedup ses-webhook
RLS_E2E=1 pnpm test:integration -- apply-rls-idempotency
pnpm test:e2e
cd ../segurasist-web
pnpm --filter @segurasist/security test
pnpm --filter @segurasist/auth test
pnpm --filter @segurasist/api-client test
pnpm --filter portal test
pnpm --filter admin test:coverage
```

**Notas clave**:
- `rm -rf .next` post-merge es OBLIGATORIO tras toques a `lib/cookie-names.ts` o `packages/security/` — Next 14 inlinea constantes en chunks; el dev server sirve cookie-names viejos sin purgar (F2 NEW-FINDING #2).
- `pnpm install` post-merge si se mergea trabajo de F5 (deps Swagger), F7 (`@segurasist/security` workspace), F9 (api-client `@testing-library/react` + `jsdom`).
- `RLS_E2E=1` requiere LocalStack/Postgres up; sin él el spec skipea graceful.

---

## 4. CI/CD gates obligatorios (NO SKIP)

> _F8 + F9 documentan_

| Gate | Threshold | Owner |
|---|---|---|
| Lint (`eslint --max-warnings=25`) | Cap 25 | F8 ci.yml |
| TypeScript strict (`tsc --noEmit`) | 0 errors | F8 ci.yml |
| Backend coverage (`segurasist-api/jest.config.ts`) | **60/55/60/60** lines/branches/functions/statements | F9 |
| Portal coverage (`apps/portal/vitest.config.ts`) | **60/55/60/60** | F9 |
| Admin coverage (`apps/admin/vitest.config.ts`) | **60/55/60/60** (real, no façade) | F9 |
| `packages/auth` coverage | **80/75/80/80** (security-critical) | F9 |
| `packages/security` coverage | **80/75/80/80** (security-critical) | F7 |
| `packages/ui` coverage | **60/55/60/60** | F9 |
| `packages/api-client` coverage | **60/55/60/60** (sin `--passWithNoTests`) | F9 |
| Lighthouse Performance | ≥85 portal `:3002` / ≥85 admin `:3001` | F9 |
| Lighthouse A11y | ≥90 | F9 |
| Lighthouse BestPractices | ≥85 | F9 |
| Lighthouse SEO | ≥80 | F9 |
| ZAP DAST | OpenAPI desbloqueado vía `v1/openapi.json` Bearer | F8 C-12 |
| Trivy scan | severity HIGH/CRITICAL + `ignore-unfixed` | F8 |
| Terraform validate | `terraform -chdir=envs/{dev,staging,prod} validate` | F8 |
| OIDC Terraform plan | roles `tf_plan_{staging,prod}` con ReadOnlyAccess | F8 C-13 |
| `--passWithNoTests` | **PROHIBIDO** en packages con código | F9 |

**Escalada Sprint 5**: 60/55/60/60 → 70/65/70/70 (decisión sección 10 AUDIT_INDEX). Security-critical mantiene 80/75/80/80.

---

## 5. Compliance + Security checklist (cada PR)

> _F3 + F6 + F7 + F8 + F10 documentan_

- [ ] **`@Throttle()`** en cada endpoint `@Public()` (login 5/min, refresh 10/min, otp 5/min, webhook 60/min).
- [ ] **DTO Zod** vía `@nestjs/zod` + `@ApiProperty` Swagger (deps F5: `@nestjs/swagger@^7.4.0`, `nestjs-zod@^3.0.0`).
- [ ] **RBAC explícito**: `@Roles(...)` declarado, no asumir defaults del módulo.
- [ ] **`assertPlatformAdmin(req.user)`** en `buildScope`/`toCtx` si el service usa `PrismaBypassRlsService` (ADR-0001).
- [ ] **RLS policy** si nueva tabla con `tenant_id`: migración + array `policies.sql` + cross-tenant test (sección 1.6).
- [ ] **Audit log** en write-paths con `AuditContextFactory.fromRequest(req)` — NO fabricar ctx ad-hoc.
- [ ] **Enum `AuditAction`** extendido en migration `ADD VALUE IF NOT EXISTS` si es nueva acción.
- [ ] **`scrubSensitive(payload)`** antes de persistir. Importar de `@common/utils/scrub-sensitive` (NO duplicar lista).
- [ ] **CSP/CORS/HSTS** no degradados — `frame-src` y `frame-ancestors` revisados si tocas iframes (F2 H-05).
- [ ] **Secrets** validados en `env.schema.ts` con `superRefine` blocklist en cualquier env + length ≥14 + símbolo en `production` (F3 C-04). NUNCA default literal de password.
- [ ] **PII redacted** en logs (`scrubSensitive` aplicado en interceptor + service).
- [ ] **Cookie hardening**: `sameSite='strict'` siempre, `secure` por allowlist `PRODUCTION_LIKE_ENVS` (F7).
- [ ] **Logout** POST + `checkOrigin` (no GET) — F7 H-07.
- [ ] **SES Tags**: `tenant_id`, `email_type` propagados (F3 H-11) si el endpoint dispara emails.
- [ ] **CloudWatch alarm** declarada en `alarms.tf` si introduce métrica nueva (custom metrics requieren emisor cableado).
- [ ] **Runbook** referenciado si introduce alarma operacional (RB-001..014).
- [ ] **`cognito-local-bootstrap.sh`** sincronizado si añadiste un claim consumido por FE (F10 H-27).

---

## 6. Glosario y referencias

**Auditoría y planning**:
- [`docs/audit/AUDIT_INDEX.md`](../audit/AUDIT_INDEX.md) — Reporte ejecutivo final (15 Critical, 57+ High, 33 controles compliance).
- [`docs/audit/_findings-feed.md`](../audit/_findings-feed.md) — Bitácora compartida (96 entradas).
- [`docs/audit/01..10-*-v2.md`](../audit/) — 10 reportes área × 2 vueltas (auth, multitenant, batches, certificates, insureds, audit-throttler, frontend-admin, frontend-portal, devops-iac, tests-dx).
- [`docs/fixes/_fixes-feed.md`](./_fixes-feed.md) — Bitácora dispatch fixes (iter 1 + iter 2 follow-ups).
- [`docs/fixes/FIXES_DISPATCH_PLAN.md`](./FIXES_DISPATCH_PLAN.md) — Plan dispatch 10 agentes paralelos.

**ADRs**:
- [`docs/adr/ADR-0001-bypass-rls-policy.md`](../adr/ADR-0001-bypass-rls-policy.md) — Política runtime para `PrismaBypassRlsService` (F10).
- [`docs/adr/ADR-0002-audit-context-factory.md`](../adr/ADR-0002-audit-context-factory.md) — Audit context factory injection strategy (F10 documentando work F6).

**Runbooks** (`segurasist-infra/docs/runbooks/`):
- RB-001 API down (F8) · RB-002 RDS CPU high (F8) · RB-003 Failover cross-region · RB-004 SQS DLQ (F8) · RB-005 WAF spike (F8) · RB-006 GuardDuty critical · RB-007 Audit degraded (F8) · RB-008 RDS PITR restore · **RB-009 KMS CMK rotation (F10)** · **RB-010 IRP triage P1 (F10)** · **RB-011 Batch stuck processing (F8 iter 2)** · **RB-012 PDF generation backlog (F8 iter 2)** · RB-013 Audit tampering (F8) · RB-014 SQS topic rename drain (F5 iter 2) · RB-015 DAST failure (renumerado desde RB-011) · RB-016 WAF rules (renumerado desde RB-012).

**Packages workspace** (`segurasist-web/packages/`):
- `@segurasist/security` — cookie/origin/proxy (F7, security-critical 80/75/80/80).
- `@segurasist/auth` — middleware/session/JWT (security-critical).
- `@segurasist/api-client` — TanStack Query hooks (60/55/60/60 post-F9).
- `@segurasist/ui` — UI primitives.
- `@segurasist/i18n` — locales.
- `@segurasist/config` — tsconfig + eslint shared.

**Scripts** (`segurasist-api/scripts/`):
- `cognito-local-bootstrap.sh` — usuarios cognito-local con claims sincronizados (post-F10).
- `localstack-bootstrap.sh` — colas SQS + buckets S3 + KMS keys (post-F5: 5 colas).
- `dev-up.sh` — docker-compose up + waits.

**Compliance**:
- [`docs/security/SECURITY_AUDIT_SPRINT_3.md`](../security/SECURITY_AUDIT_SPRINT_3.md) — Auditoría seguridad independiente.
- [`docs/qa/QA_COVERAGE_AUDIT_SPRINT_3.md`](../qa/QA_COVERAGE_AUDIT_SPRINT_3.md) — Auditoría QA cobertura.
- [`docs/OWASP_TOP_10_COVERAGE.md`](../OWASP_TOP_10_COVERAGE.md), [`docs/IRP.md`](../IRP.md), [`docs/INTERIM_RISKS.md`](../INTERIM_RISKS.md), [`docs/SUB_PROCESSORS.md`](../SUB_PROCESSORS.md), [`docs/LOCAL_DEV.md`](../LOCAL_DEV.md), [`docs/PROGRESS.md`](../PROGRESS.md).

---

## 7. ADRs (Architectural Decision Records)

### Completados (Sprint 4)

- ✅ **ADR-0001 — Bypass RLS Policy** (autor F10 iter 1). Política runtime + 16 callers documentados + 4 alternativas rechazadas.
- ✅ **ADR-0002 — Audit Context Factory Injection** (autor F10 iter 1, referencia work F6). Singleton invocado en controllers + 4 alternativas rechazadas.

### Pendientes (Sprint 5+)

| # | Slug | Prioridad | Owner sugerido | Trigger |
|---|---|---|---|---|
| ADR-0003 | `sqs-dedupeid-vs-fifo-migration` | **P1** | F5 / DevOps | Decidir Sprint 5 si workers cambian a FIFO o si DB-side idempotency es definitivo. Hoy DB-side cierra el gap; FIFO es opcional para ordering futuro. |
| ADR-0004 | `packages-security-npm-private-vs-workspace` | P2 | F7 | Si Sprint 5+ extracts `@segurasist/security` a npm private (artifactory/CodeArtifact) vs mantener workspace. Affects publish pipeline + version bumps. |
| ADR-0005 | `cloudwatch-alarms-cardinality-multi-region` | P2 | F8 | Multi-region (mx-central-1 + us-east-1 CloudFront) ya forzado por WAF scope; ADR formaliza criterio para cuándo agregar más regiones (DR-secondary, customer regional). |
| ADR-0006 | `coverage-thresholds-tier-policy` | P3 | F9 | Formaliza tiers: security-critical 80/75/80/80, business 60/55/60/60 → 70/65/70/70 Sprint 5. Política para nuevos packages (default tier). |
| ADR-0007 | `runbook-lifecycle-policy` | P3 | F8 | Numbering, deprecación, versioning de runbooks; F8 iter 1 reemplazó RB-002/004/005/007 legacy — ADR formaliza el procedimiento. |

---

## 8. Lessons-learned por bundle (F1..F10)

### F1 — B-PDF (workers/pdf-worker, certificates)

1. **`createHash` calculate-and-discard es anti-pattern**: si computas un SHA, persistilo o emitilo. `void hash;` es señal de bug.
2. **Render 2-pass para QR cíclicos**: cuando el contenido del QR depende del SHA del PDF, single-pass produce hashes inconsistentes con la verificación. PASS-1 sin upload → SHA(PASS-1) → PASS-2 con upload + persist.
3. **S3 metadata para auditoría off-band**: `x-hash` (lookup BD) y `x-sha256-content` (SHA real del archivo) como campos separados permiten forensics sin tocar BD.
4. **Tests de invariante hash recomputan, no regex-match**: `expect(hash).toMatch(/^[a-f0-9]{64}$/)` pasa con cualquier random; el correcto es `expect(hash).toBe(createHash('sha256').update(buffer).digest('hex'))`.
5. **Bugs cross-bundle se enmascaran mutuamente**: C-01 (hash random) + H-05 (CSP frame-src) creaban un caso de uso roto end-to-end. Dispatch debe coordinar smoke en pares cuando un flujo cruza ≥2 áreas.

### F2 — B-PORTAL-AUTH + B-CSP (apps/portal, auth.service)

1. **`*_COOKIE` SIEMPRE desde `lib/cookie-names.ts` per-app**: portal usa `PORTAL_SESSION_COOKIE` (`sa_session_portal`); importar de `@segurasist/auth` trae la cookie del admin (`sa_session`) → 401 cascadeo silencioso.
2. **CSP `frame-src` ≠ `frame-ancestors`**: ortogonales. `frame-src` controla qué iframes embebes; `frame-ancestors` controla quién te embebe. Default-src fallback del primero es invisible en dev local pero rompe prod.
3. **Persistencia post-Cognito-success debe ser best-effort**: OTP exitoso jamás se rompe por una falla de BD secundaria. `try { update } catch { log.warn }` — el estado se reconcilia en el siguiente login.
4. **JWTs propios → `decodeJwt`, no `jwtVerify`**: la firma se verifica en `JwtAuthGuard` con JWKS; duplicarla aquí es defense-in-redundancy, no defense-in-depth.
5. **`prisma.update().where`** solo admite `@unique` o PK. Para insureds usa `{ id: insuredId }` (PK); `tenantId` se conserva en logs/audit pero no en filtro.

### F3 — B-AUTH-SEC + B-RLS + B-EMAIL-TAGS (env.schema, policies.sql, ses.service)

1. **Env vars con secretos compartidos NO tienen default literal**: `INSURED_DEFAULT_PASSWORD` es la lección viva. Patrón: `z.string().min(N) + superRefine` con blocklist en cualquier env + reglas extra en `production` (length ≥14, símbolo). `.env.example` documenta generación (`openssl rand -base64 ...`).
2. **TODA tabla con `tenant_id` listada en `policies.sql`** array en el mismo PR — `apply-rls.sh` la omite en re-aplicación si falta. Test integration `apply-rls-idempotency.spec.ts` es tripwire.
3. **Endpoints `@Public()` REQUIEREN `@Throttle()`**: refresh `10/min` (silent-refresh ~6/min legítimo); login `5/min`; OTP `5/min`. Cap por endpoint, no global.
4. **AWS SDK v3 `SendEmailCommand` SÍ soporta `Tags:[{Name,Value}]`**: NO requiere `SendRawEmailCommand`. Pasar `tenant_id` y `email_type` activa CloudWatch dimensions + SNS bounce/complaint segmentation por tenant. Sanitizar a regex `[A-Za-z0-9_-]{1,256}`.
5. **Tests integration con DB real se gatean por env** (`RLS_E2E=1`, `OTP_FLOW_E2E=1`). Tests estáticos (parseo del repo) corren siempre como tripwire.

### F4 — B-BATCHES (batches.service, validator, workers)

1. **State machine post-confirm separada**: `processed_rows / success_rows / failed_rows / queued_count` son del worker; `rows_ok / rows_error` son de validation. Dos universos; el worker NUNCA pisa los counts de validación.
2. **Exactly-once en colas standard via DB**: UNIQUE PARTIAL INDEX + CAS atómico (`UPDATE … WHERE col IS NULL`). NO depender de `MessageDeduplicationId` — AWS lo descarta silently.
3. **Pre-cómputo antes de loops chunked**: cuando un loop chunked necesita info global del set (dedup, totals), pre-computarla ANTES y pasarla al callee como param opcional. Aplicable a `reports-worker`, `insureds.service.search`.
4. **`UPDATE … RETURNING` > `UPDATE` + `findFirst`**: evita TOCTOU sin bloqueos explícitos. La fila post-update viene atómicamente.
5. **Migrations cross-agente con `Edit` no `Write`**: dos agentes (F4 + F6) editaron `schema.prisma` simultáneamente sin conflict — cada uno tocó solo su sección (model `Batch` vs enum `AuditAction`). Lock implícito por sección.

### F5 — B-INFRA-SQS + B-WEBHOOK (sqs.service, ses-webhook)

1. **Firma webhook crypto > regex URL**: SNS/SES/GitHub webhooks se validan con dep dedicada (`aws-sns-validator`) + fallback host check. NUNCA con regex sobre la URL del cert; produce 401 genérico sin leak.
2. **Idempotencia colas standard vive en DB**: UNIQUE constraint con natural key (`tenant_id, batch_id, row_number`) es source of truth. `MessageDeduplicationId` solo en FIFO.
3. **Throttle a nivel CLASE > per-handler** cuando todos los endpoints comparten perfil de abuso (webhooks). Cualquier handler nuevo hereda el cap automáticamente sin riesgo de olvido.
4. **Tests "no propagation" son irreemplazables**: verifican que un parámetro eliminado NO llega al SDK aunque el caller lo fuerce con cast TS. Única defensa contra zombie code.
5. **DLQ con `maxReceiveCount=3` mínimo**: sin DLQ un mensaje envenenado bloquea o pierde la cola. Redrive policy obligatoria por queue.

### F6 — B-AUDIT (audit-writer, audit-chain-verifier, AuditContextFactory)

1. **Audit context canónico**: jamás construir `{ip, userAgent, traceId}` ad-hoc. Inyectar `AuditContextFactory` y `auditCtx.fromRequest(req)`. Workers SQS son única excepción legítima.
2. **Hash chain verification = full SHA o nada**: encadenar `prev_hash` sin recompute de `row_hash` es falso positivo. Defense-in-depth = full SHA en DB + cross-check contra S3 mirror Object Lock.
3. **Single source of truth para `SENSITIVE_LOG_KEYS` y `scrubSensitive`**: cualquier código que necesite redactar PII importa de `@common/utils/scrub-sensitive`. Listas duplicadas en interceptors/loggers/services = drift garantizado.
4. **Enum `AuditAction` extend > `subAction` en payloadDiff**: type-safe en compile-time + queries SQL eficientes (`WHERE action = 'read_downloaded'` indexable, vs scan JSON).
5. **Postgres `ALTER TYPE … ADD VALUE`**: idempotente con `IF NOT EXISTS`, soportado PG 12+. Para extends declarativos (sin uso del nuevo valor en la misma tx) basta una migration.

### F7 — B-COOKIES-DRY (packages/security)

1. **Single source of truth cookie security**: cualquier endpoint que escribe cookie de sesión va por `@segurasist/security/cookie`. Apps tienen re-exports legacy en `lib/cookie-config.ts`. El factory FUERZA `sameSite='strict'`; sin opción de relajar.
2. **`secure` por allowlist `PRODUCTION_LIKE_ENVS`, no `=== 'production'`**: defensa contra config drift. `NODE_ENV='prod'` o `'production-staging'` no emite Secure si no están en la allowlist explícita.
3. **Logout JAMÁS via GET**: `SameSite=Strict` no protege un GET top-level (image tag, navegación, prefetch). Toda mutación de sesión es POST + `checkOrigin`. GET → 405 explícito.
4. **Defense-in-depth Origin**: middleware + handler. Aunque `apps/{admin,portal}/middleware.ts` ya valida Origin, los handlers state-changing (logout, proxy, OTP verify) re-validan localmente. Costo: 5 líneas; beneficio: clase entera de regresiones imposible.
5. **Patrón "primitivo + advanced"** para reglas reusables: `checkOrigin` boolean simple para uso embedded; `checkOriginAdvanced` con webhook exemptions y razones de rechazo para middleware. Apps componen el primero; per-app `lib/origin-allowlist.ts` envuelve el segundo.

### F8 — B-CI + B-OBSERVABILITY (alarms.tf, iam-github-oidc, Trivy)

1. **Variable scoping Terraform**: declarar variables en el `.tf` que las consume (no siempre `variables.tf` central) preserva ownership entre agentes/equipos.
2. **Custom metrics requieren emisor cableado**: una alarma `INSUFFICIENT_DATA` por métrica inexistente es peor que no tener la alarma — produce ruido cognitivo. Documentar siempre qué servicio emite cada custom metric y bloquear merge si el emisor no está cableado.
3. **CloudFront alarms viven en `us-east-1`**: WAF scope `CLOUDFRONT` obliga SNS topic dedicado en `us-east-1` (CW Cross-Region Alarms no GA en `mx-central-1`).
4. **Runbook numbering preserva identity**: una vez asignado un número (RB-002), no reasignarlo aunque el topic cambie. Preferir crear nuevo número y marcar el viejo como DEPRECATED. Excepción: el dispatch plan iter 1 reemplazó RB-002/004/005/007 (anotados deprecation).
5. **Trivy `ignore-unfixed` + severity HIGH/CRITICAL**: combo que mantiene FP < 50%. Sin `ignore-unfixed` el ratio supera el umbral accionable.

### F9 — B-COVERAGE + B-CROSS-TENANT + B-TESTS-* (configs + 89 tests)

1. **Façade `coverage.include` selectivo PROHIBIDO**: enumerar archivos manualmente excluye silenciosamente los archivos con findings. Usar `include: ['app/**', 'lib/**', 'components/**']` + `exclude` granular.
2. **`THROTTLE_ENABLED=false` global enmascara endpoints sin `@Throttle`**: e2e setup debe setear `THROTTLE_LIMIT_DEFAULT=100` (suficiente para suite, captura loops 1000+ req/min). Specs que necesitan disable hacen override puntual.
3. **`it.todo` con stub bootstrap = it.todo real**: el test que existe pero no testea nada es peor que el `it.todo` honest. Convertir a `describe.each(MATRIX)` con asserts mínimos (status NUNCA 200, body NO leak regex).
4. **`--passWithNoTests` PROHIBIDO en packages con código**: el package corría 26 hooks sin un solo test. Eliminado + 50 tests añadidos. Si el package no tiene tests aún, stub `expect(true).toBe(true)` con TODO + issue.
5. **Lighthouse / Playwright apuntan al puerto correcto**: portal `:3002`, admin `:3001`. Un solo carácter mal en `lighthouserc.js` mide la app equivocada y los gaps de Performance/A11y son ficticios.

### F10 — B-DRY + B-UX-FIXES + B-DOCS + B-COGNITO-CLAIMS + B-TYPES-CLEANUP + B-BYPASS-AUDIT

1. **Triplicación byte-idéntica**: `buildInsuredsWhere` aparecía idéntico en 3 sites. Tests por orden (`or[3]`) detectan rotación, NO drift. Cualquier WHERE en >1 site → `<resource>/where-builder.ts` shared.
2. **Casts post-migración Prisma** son deuda residual: `as unknown as Prisma.X` que silenciaban TS pre-migración quedan obsoletos al aplicar la migración. Grep + remove tras cada Prisma migration merge.
3. **Bypass RLS necesita guard runtime**: `RolesGuard` HTTP no es suficiente. `assertPlatformAdmin(req.user)` en `buildScope`/`toCtx` de cada controller que rutea a service con bypass. Workers exentos con JSDoc + tenantId explícito.
4. **Cognito-local-bootstrap.sh sincronizado con claims FE**: cuando agregas un claim al JWT que el FE consume (greeting, avatar, theme), sincronizar bootstrap en el mismo PR. El cognito real ya tiene standard attributes; el local debe popularlos explícitamente.
5. **ADR template canónico**: Context / Decision / Consequences / Alternatives considered (cada alternativa con razón de rechazo) / Follow-ups. El formato fuerza el rigor — alternativa sin razón = decisión débil.

---

### Sprint 4 — lecciones cross-bundle (S1..S10) — iter 1 cross-cutting

> _S10 consolidó iter 1; iter 2 add-on debajo._

1. **Reports + workers comparten `where-builder` con `reports-worker`** (anti-pattern §1.8 evolution): cuando S1 añade nuevos filtros (period range, package, status), DEBE migrar al builder shared `insureds/where-builder.ts`. Si el builder no cubre un caso (period close-of-month vs open-range), extender con casos opcionales — NO inline en el worker.
2. **PDF/XLSX rendering reutilización**: `reports-pdf-renderer.service.ts` y `reports-xlsx-renderer.service.ts` (S1 owners) son punto único; tests que verifican output binary deben round-trip via `pdf-parse` + `exceljs.read(buf)`. NO `expect(buf.length).toBeGreaterThan(0)` que enmascara renders vacíos.
3. **Chatbot KB requiere RLS + cross-tenant test obligatorio**: tabla nueva `kb_entries` con `tenant_id` ⇒ §1.6 anti-pattern. Sin cross-tenant test el leak es invisible al desarrollador local (Prisma sin `app.current_tenant` set retorna 0 filas).
4. **Personalization placeholders ≠ template engine**: la tentación de usar Handlebars/EJS es alta. RECHAZADO: superficie de ataque XSS. Pattern Sprint 4: regex whitelist `/{{(insured|policy|coverage|tenant)\.[^}]+}}/g` + lookup explícito por path.
5. **EventBridge "at-least-once" → DB-side UNIQUE OBLIGATORIO**: análogo a §1.2 (SQS standard). Cualquier scheduled trigger requiere `(tenant_id, period|key)` UNIQUE para idempotencia. ADR-0003 formaliza.
6. **Audit timeline en vista 360 reusa `audit_log`**: no inventar `audit_timeline_events` separado.
7. **4 nuevas `AuditAction` Sprint 4**: migración unificada Sprint 5 (deferral por bridges Sprint 4 — payloadDiff.event/subAction).
8. **Performance gate Sprint 4 (S8 JMeter)**: 1k portal sessions + 100 admin → p95 ≤500 ms. Post-merge staging.
9. **Coverage no decrece**: snapshot diff `coverage-summary.json` iter1 vs iter2. Ver `docs/sprint4/COVERAGE_DIFF.md`.
10. **DEVELOPER_GUIDE como single source**: cualquier patrón "cómo agrego X" en Sprint 4 que NO esté en §2 es una omisión.

---

### Sprint 4 — lecciones por agente (5 c/u — iter 2 sello final)

> _S10 iter 2 consolidó tras leer S1..S9 reports. 50 lecciones (10 agentes × 5)._

#### S1 — Reports BE (S4-01/02/03 backend, 23 pts)

1. **Renderers PDF stateless = single-pass**: a diferencia de los certificados (§1.4: 2-pass por QR cíclico SHA), los reportes no incrustan QR ni firman SHA. Single-pass `puppeteer.renderPdf({html, format:'A4'})` basta. La regla 2-pass aplica solo cuando el contenido depende del SHA del contenedor.
2. **Reusar `PuppeteerService` singleton vía `CertificatesModule` import**: evita doble launch de Chromium (~300MB RAM idle por instancia). El módulo dueño exporta el provider; el módulo cliente importa y recibe la instancia compartida.
3. **`@Res({passthrough:true})` para binary streams en Fastify**: permite headers custom (Content-Type, Content-Disposition) sin renunciar al pipeline Nest (filters, interceptors). Anti-pattern: `res.send()` directo desactiva interceptors.
4. **Cache TTL escalable por tipo de reporte**: histórico (period en pasado) tolera TTL alto (300s); operacional (volumetría open-ended hoy) requiere TTL corto (60s). `cached(key, compute, ttl?)` con default sano + override explícito para hot paths.
5. **`coverageUsage.groupBy` + `coverage.findMany` lookup paralelo > join**: Prisma no permite groupBy con joins. Pattern alternativo: groupBy por FK → `findMany({where:{id:{in:ids}}})` → in-memory join. Más roundtrips pero permite filtros RLS-aware sin SQL crudo.

#### S2 — Reports FE (S4-01/02/03 frontend)

1. **Chart primitives en `@segurasist/ui/components/charts/`**: `<LineChart />` y `<BarChart />` viven ahí. NO duplicar recharts wrappers en apps; usar el primitive y pasar `series` + `xKey`/`categoryKey`. Apps con shapes específicas (sparkline) pueden seguir teniendo wrappers locales finos.
2. **Binary downloads (Safari-safe)**: patrón `URL.createObjectURL(blob) + click <a> + setTimeout(revoke, 0)`. Bypassea `api()` JSON wrapper porque el proxy reenvía bytes raw con content-type correcto. Cualquier nuevo download endpoint usa `useDownloadReport`-style hook con mutation aislada por `(type, format)` para que ambos botones tengan estado pending independiente.
3. **Generic constraint en componentes recharts**: usar `<T>` simple en lugar de `T extends Record<string, unknown>` (TS no infiere index signature en interfaces declaradas; el constraint romperá uso desde el cliente). Cast interno a `Array<Record<string, unknown>>` en el render layer.
4. **DTOs sin coordinación previa = realineación midstream**: empezamos iter1 antes de que S1 publicara shapes; resultó en `rows[]` → agregado, `used/limit` → `usageAmount/Count`. Lección §1.15: en bundles cross-bundle (BE+FE) FE espera feed BE-`SHAPE-FROZEN` para shapes complejas; filtros simples (qs) la espera es opcional.
5. **Test integration con `(app)` route group de Next.js**: parens-group resuelve OK con `import('../../app/(app)/...')` en vitest si vitest config alias `@` apunta correctamente. Mockear los hooks api-client a nivel `vi.mock(...)` antes del import de la página evita armar QueryClient real con polling.

#### S3 — DevOps + Backend Cron (S4-04, 5 pts)

1. **EventBridge → SQS pattern**: queue policy va a env-level (no module), declarada con `data.aws_iam_policy_document` + condition `aws:SourceArn = rule_arn` (defense-in-depth contra confused-deputy). Si N rules apuntan a la misma queue, una sola policy con array de SourceArns.
2. **Cron TZ caveat (§1.12)**: `aws_cloudwatch_event_rule.schedule_expression` solo UTC; documentar el desfase TZ en el comentario del módulo y considerar `aws_scheduler_schedule` para v2.
3. **Idempotencia DB-side semántica skip vs failed**: P2002 (UNIQUE violation) → `skipped` (NO emite audit log adicional, la corrida original ya lo hizo). Resilencia per-tenant: `processTenant()` retorna `'completed' | 'skipped' | 'failed'` y el handler global agrega contadores; un tenant fallando NO aborta a los otros.
4. **DI token para generators externos**: cuando un módulo S(X) depende de lógica que otro módulo S(Y) implementa, exponer interface + token DI (`MONTHLY_REPORT_GENERATOR`) y dejar stub `NotImplemented` permite que S(X) cierre su iter sin bloquear; S(Y) inyecta el provider real en iter 2.
5. **Workers exentos del `assertPlatformAdmin`**: aplicado en `MonthlyReportsHandlerService` con BYPASSRLS + `tenantId` explícito en cada query (igual que `ReportsWorker` y `InsuredsCreationWorker`). Documentar en JSDoc del service y referenciar ADR-0001.

#### S4 — Frontend Senior Chatbot (S4-05 + S4-08, 8 pts)

1. **Widgets globales de portal van bajo `(app)/layout.tsx`, no en página individual**: el layout es Server Component y monta el widget Client Component una sola vez; React Query + zustand sobreviven al `<Link>` navigation porque el layout no se desmonta.
2. **Pattern para rutas API estáticas que reutilizan `makeProxyHandler`**: pasar context fake `{params:{path:[…]}}`. Trade-off: rutas dedicadas (granularidad de métricas) vs catchall (DRY). Decisión arquitectural en el feed, no en el código.
3. **Persistencia client-only opcional con zustand**: NO usar middleware `persist` cuando se quiere TTL + capa anti-bloat + schema versionado. Manual `read/writePersisted` es ~30 líneas y deja control total para invalidar caches viejos sin migrar el shape.
4. **Hooks de mutation que aceptan shape evolutivo (S5/S6)**: tipar response con `[extra: unknown]` index signature + campos opcionales. El cliente no se rompe si backend agrega keys; cuando S5/S6 firmen el DTO, refinar tipos sin tocar widgets. (Bridge §1.15 — usar con `// TODO BE-iter2`).
5. **Test de widget con mock de fetch global** (no MSW): mismo patrón que `insured-flow.spec.ts`. Helper `setupFetchMock(handler)` por archivo, restore en `afterEach`. Cubre path/verbo/body/headers — más que suficiente para chatbot.

#### S5 — Backend Senior NLP/KB (S4-06, 8 pts)

1. **Modelos pre-existentes con columnas TODO: extender > duplicar (§1.16)**. La migración `ADD COLUMN IF NOT EXISTS` permite cohabitar Sprint 1 stubs con campos Sprint 4+ sin romper datos. Antes de crear `model NEW`, grep el schema.
2. **EscalationService crossover S5↔S6**: dispatch plan asignó "S5 o S6 — decidir iter1". Coordiné inspeccionando el filesystem antes de escribir; S6 ya tenía la versión robusta. Lección: revisar siempre `ls` del path NEW antes de escribir, otro agente puede haberlo hecho primero.
3. **Audit action enum vs `payloadDiff.event`**: cuando un nuevo dominio (chatbot) emite events, decidir entre extender enum (queries SQL eficientes) o usar `payloadDiff.event` (cero coordinación). Iter1 elegí lo segundo; documentado como bridge + ADR follow-up. Sprint 5 unifica con migración `<DATE>_audit_action_sprint4`.
4. **Matcher puro testeable**: el algoritmo `tokenize + scoreEntry + findBestMatch` está sin Prisma → testable sin mocks. Patrón replicable para otros NLP-style services (Sprint 5+ semantic search).
5. **Personalization fail-soft con try/catch**: cuando un service llama otro service que puede degradar (BD/network), preferir best-effort + log.warn antes que propagar — el chat NUNCA debe responder 500 al insured por una falla downstream.

#### S6 — Backend Personalization + Escalation (S4-07 + S4-08, 8 pts)

1. **Templates con placeholders separan método puro (`applyTemplate`) del método con I/O (`fillPlaceholders`)** — permite testear el template engine sin Prisma mock y mantener coverage alto sin overhead.
2. **Fechas localizadas con `timeZone` explícito**: `toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' })` previene drift entre Lambda UTC y CDMX. Aplicable a toda salida HTML/email/chat.
3. **Idempotencia coarse-grained como bridge**: cuando un modelo dependiente todavía no existe (`ChatConversation`), usar un campo binario existente (`escalated: boolean`) + ventana temporal 60min es preferible a bloquear la historia esperando schema. Documentar el bridge en docstring + feed para refactor en iter siguiente.
4. **HTML escape en emails**: cualquier campo con contenido user-provided (`reason`, `content`, `fullName`) debe pasar por `escapeHtml()` antes de inyectarse en el template — Mailpit y muchos clientes MAC renderizan HTML por default y las preview panes son un sumidero clásico de XSS.
5. **Audit `subAction` en `payloadDiff` como bridge no permanente**: para acciones que no encajan en el enum DB existente (`escalated` no está en `AuditAction`), reusar `action='update'` + `payloadDiff.subAction='<verbo>'` mantiene la cadena hash sin requerir migración del enum. Sprint 5: migración unificada.

#### S7 — Audit Timeline 360° (S4-09, 5 pts)

1. **Streaming CSV con async generator + Fastify `reply.raw`** es el pattern correcto: zero buffering, throttle 2/min defensivo, hard cap secundario por si el throttle se desconfigura. Pattern para futuras streaming exports (insureds CSV, audit-log CSV bulk).
2. **Auditoría de auditoría**: cuando un endpoint expone audit logs (export, verify-chain), DEBE registrarse en el propio `audit_log` con `resourceType='audit.<feature>'`. Sirve para forensics: si alguien filtra el CSV de un tenant, queda evidencia.
3. **Keyset cursor opaco**: `base64url(JSON({id, occurredAt}))`. El cliente NO inspecciona; reuse del codec `audit-cursor.ts` evita drift entre `/audit/log` y `/audit/timeline`.
4. **`useInfiniteQuery` con `getNextPageParam`**: patrón estándar para paginación cursor en TanStack Query 5; añadir snippet en §2.4 cuando aplique listas largas (timeline, notifications, etc.).
5. **JSON path matching en Postgres via Prisma** (`payloadDiff: {path:['insuredId'], equals:X}`) funciona pero requiere GIN index `((payload_diff))` para escalar. Documentado como anti-pattern futuro Sprint 5+ si p95 timeline > 150ms.

#### S8 — DevOps Performance (S4-10, 5 pts)

1. **Performance budgets per-endpoint > global**. El gate global (500 ms) no es suficiente — endpoints específicos necesitan budgets más estrictos (read = 300 ms) o más laxos (chatbot = 800 ms). Estos viven en `baseline.json` y son revisados en cada PR de `tests/performance/**`.
2. **Load test data debe ser determinístico**. Seed fija (42 portal, 7 admin) para que dos runs sean comparables. Evitar `Math.random()` sin seed — ruido desestabiliza el gate.
3. **Throughput Controller > Random Controller** (JMeter). Random Controller no garantiza distribución exacta del mix; Throughput Controller (style=1 percent) sí. Replicable a k6 con `executor: 'ramping-arrival-rate'` por escenario.
4. **Login una vez por VU** (`OnceOnlyController` JMeter): evita explosión de tokens y refleja patrón real (un usuario no re-loguea cada request). Cookie Manager + JSON extractor mantienen el token vivo toda la sesión.
5. **CI gate como `workflow_dispatch` + cron, NO en PR**. El load test contra staging cuesta tiempo+dinero; correrlo en cada PR es anti-DX. Regla: `perf.yml` corre semanal + on-demand; PRs siguen un light-smoke (futuro: 10 vu × 1 min en `ci.yml` para detectar regresión gruesa).

#### S9 — Backend Senior Hardening (8 High remanentes + 5 ADRs)

1. **`describe.skip` con `it.todo` apuntando a "tests pendientes" = test fantasma**: el suite OTP H-09 estuvo skip 3+ sprints. Cierre: 14 tests unit con mocks reales (Redis/Cognito/SES/AuditWriter) + helpers `buildJwt`/`preloadSession`/`buildService(opts)`. Aplicar a cualquier `describe.skip` en suite — convertir a tests reales o eliminar.
2. **Migrations idempotentes via `IF NOT EXISTS` / `DO $$ ... pg_type ... pg_constraint`**: 6 migraciones Sprint 4 inspeccionadas; 3 con guards explícitos seguras a manual replay, 3 dependen de Prisma `_prisma_migrations` tracking. PR rule Sprint 5: "toda nueva migración usa guards" para sobrevivir a manual replays.
3. **EMF emitter ↔ alarms `Environment` dimension MUST match (§1.14)**: emitter `process.env.NODE_ENV` ≠ alarmas `var.environment` → INSUFFICIENT_DATA permanente en dev/prod. Test integration cross-component obligatorio en Sprint 5.
4. **ADR template canónico**: Context / Decision / Consequences (Positive + Negative) / Alternatives considered (≥3 con razón de rechazo) / Follow-ups. El formato fuerza el rigor — alternativa sin razón = decisión débil. 5 ADRs Sprint 4 con 18 alternativas totales documentadas.
5. **Param-passing `auditCtx?` > `Scope.REQUEST` en services hot-path**: medición ADR-0004 +30% latencia con `Scope.REQUEST` en login. Param-passing preserva throughput crítico; `AuditContextFactory` request-scoped por defecto, opt-out en services no-request-scoped (AuthService, futuros HealthService/RpcGateway).

#### S10 — QA Lead + Tech Writer (E2E + DEVELOPER_GUIDE + DoR/DoD + cleanup)

1. **DoR/DoD validation matrix por historia ANTES de iter 1 (gating de entrada al sprint)**: 17 columnas (A..Q) + 10 historias = 170 cells. Sin matriz, "DoR cleared" es asunto vago. Owner QA Lead, audiencia PO + tech lead.
2. **E2E spec con `skipIfBootstrap` graceful**: tests con asserts reales que toleran 200/501 cuando el endpoint no está implementado al cierre iter 1 — permite TDD-led infrastructure (test escrito antes que el endpoint, no fail en CI sin docker). Pattern de `insured-360.e2e-spec.ts` extendido a Sprint 4.
3. **Coverage diff iter1↔iter2 con `coverage-summary.json`**: NEW-FINDING-S10-04 — sin snapshot, % global puede caer silenciosamente aunque cada nuevo módulo tenga 80%. Documento `docs/sprint4/COVERAGE_DIFF.md` con TODO orquestador.
4. **Cleanup placeholder code post-deploy**: `chat-fab.tsx` placeholder Sprint 3 quedó huérfano post-iter1 widget chatbot real (S4 NEW-FINDING). Audit obligatorio en cierre sprint: grep referencias + delete archivos no consumidos.
5. **DEVELOPER_GUIDE como single source of truth + sprint-by-sprint extension**: §2.X cheat-sheet crece +1 sección por nuevo tipo de cambio (Sprint 4: §2.6 chart/report, §2.7 chatbot KB, §2.8 EventBridge cron). §1 anti-patterns crece con cada finding sistémico (Sprint 4: §1.12 TZ + §1.13 SES SDK + §1.14 EMF dim + §1.15 contract-first + §1.16 modelos pre-existentes). §8 lecciones por bundle/agente.

---

## Sprint 5 Anti-patterns (added iter 2 — CC-04)

> Cinco agentes (MT-2, MT-3, MT-4, S5-3, DS-1) repitieron patrones similares al
> integrar el portal multi-tenant + Lordicons + GSAP + brandable theming. Todas
> las entradas de abajo son **lectura obligatoria** antes de tocar
> `segurasist-web/packages/{ui,api-client,security,auth}/` o cualquier app
> Next.js a partir de Sprint 6. Owner: DS-1 (Sprint 5).

#### S5.1 Roles RBAC reales: `admin_segurasist` / `admin_mac` (NO `superadmin` / `tenant_admin`)

**Evidencia (Sprint 5, MT-2 + S5-3 iter 1)**:
- Scaffolding inicial usó nombres ficticios `superadmin` y `tenant_admin` en
  guards de página y en componentes — derivados de la documentación de
  arquitectura, no del código.
- Roles reales viven en `segurasist-api/src/common/decorators/roles.decorator.ts`:
  `'admin_segurasist' | 'admin_mac' | 'operator' | 'supervisor' | 'insured'`.
- `packages/security/test/jwt.spec.ts` valida claim `custom:role=admin_mac` —
  cualquier UI que asuma otro string falla en runtime sin error de tipo.

**Regla preventiva**:
1. Antes de scaffold de cualquier feature con RBAC, leer
   `segurasist-api/src/common/decorators/roles.decorator.ts` (canonical) y
   `packages/security/src/jwt.ts` (claim parsing).
2. NUNCA inventar nombres de roles a partir del PRD/arquitectura — el código es
   source of truth. El término "superadmin" se usa en docs como sinónimo
   coloquial de `admin_segurasist`, pero la string literal NO existe.
3. Tests RBAC siempre usan los roles reales (`Roles('admin_mac', 'operator')`).

**Lección Sprint 6+**: cualquier referencia a `superadmin` o `tenant_admin` en
PRs nuevos es smell de scaffolding pre-leyendo-código. Reviewer rechaza.

---

#### S5.2 `api()` wrapper fija JSON Content-Type — multipart needs `apiMultipart()`

**Evidencia (Sprint 5, MT-2 iter 1 — CC-03)**:
- `packages/api-client/src/index.ts:api()` setea
  `headers['Content-Type']='application/json'` por construcción.
- MT-2 quiso subir un logo (FormData) y bypassed con `fetch()` directo, lo que
  desconectó refresh-token rotation, retry y parsing de errores estándar.
- El `Content-Type: application/json` con un `FormData` body causa el clásico
  "missing boundary" en Fastify multipart, sin error útil.

**Fix Sprint 5 iter 2 (MT-2)**:
- Export `apiMultipart()` en `packages/api-client/src/index.ts` que:
  - Acepta `FormData` directo.
  - **Omite** `Content-Type` para que el browser inyecte el boundary.
  - Reusa el flujo de auth (refresh + retry on 401).

**Regla preventiva**:
1. `FormData` → `apiMultipart()`. JSON → `api()`. NO mezclar.
2. NUNCA setear `Content-Type` manualmente con FormData (ni en hooks ni en
   action handlers).
3. Test de cliente verifica que el header NO contiene `application/json`
   cuando body es `FormData`.

**Lección Sprint 6+**: cualquier `fetch()` directo en `apps/{admin,portal}` es
candidato a refactor. El wrapper centraliza retry, refresh y telemetry.

---

#### S5.3 CSP rules viven en `next.config.mjs`, NO en `middleware.ts`

**Evidencia (Sprint 5, MT-3 iter 1 — CC-01)**:
- MT-3 intentó añadir `script-src https://cdn.lordicon.com` en `middleware.ts`
  setting headers. El header llegó a la respuesta pero **no a las páginas
  estáticas** (Next.js sirve assets prerenderizados sin pasar por middleware
  para rutas con ISR pre-build).
- Solución: las rules viven en `next.config.mjs` `headers()` async, donde Next
  las inyecta en TODAS las rutas (estáticas, ISR, dinámicas).

**Regla preventiva**:
1. CSP / X-Frame-Options / X-Content-Type-Options → `next.config.mjs`.
2. Cookies, redirects, auth → `middleware.ts`.
3. Cualquier nuevo header de seguridad pasa por el helper
   `packages/security/src/csp.ts` (single source of truth para policy strings)
   y se inyecta en `next.config.mjs` per-app.

**Lección Sprint 6+**: si un header "no aparece" en una ruta, primero
verificar que está en `next.config.mjs` antes de debuggear middleware.

---

#### S5.4 Web components custom (Lordicon) requieren `'use client'` + register en useEffect

**Evidencia (Sprint 5, DS-1 iter 1)**:
- `lord-icon-element` registra un custom element via
  `customElements.define('lord-icon', ...)`. Esto NO es SSR-safe: en Node no
  existe `customElements`, y en cliente hacerlo a top-level dispara durante
  hydration mismatches si el server renderizó el tag desconocido.

**Fix Sprint 5 (DS-1, ya en `packages/ui/src/lord-icon/lord-icon.tsx`)**:
- Componente con `'use client'` directive.
- `registerLordIconElement()` con guard `typeof window === 'undefined'`,
  idempotente (memoiza la promise), y llamado dentro de `useEffect`.
- Pre-hidratación renderiza un fallback `<span>` del tamaño exacto del icono
  para evitar layout shift.

**Regla preventiva**:
1. Cualquier import que pegue al DOM en evaluation time (`customElements`,
   `window.navigator`, `document.adoptedStyleSheets`) → dynamic import dentro
   de `useEffect`.
2. Componentes que envuelven web components SIEMPRE llevan `'use client'` y
   un fallback con dimensiones explícitas (anti CLS).
3. `if (window.customElements?.get('mi-tag'))` antes de definir → idempotencia.

**Lección Sprint 6+**: Lottie/Three.js/Mapbox/etc. siguen el mismo patrón.
Antes de añadir una librería con web component / canvas, leer este apartado.

---

#### S5.5 GSAP plugins solo `if (typeof window !== 'undefined')` + cleanup `kill()` en unmount

**Evidencia (Sprint 5, DS-1 iter 1)**:
- GSAP core funciona en Node (no toca `window`), pero plugins como
  `ScrollTrigger`, `Draggable`, `MotionPathPlugin` SÍ acceden a `window` en
  init, rompiendo el SSR build.
- Sin `tween.kill()` en cleanup del `useEffect`, navegar entre rutas con
  React Strict Mode (double-invoke) duplica los tweens y dispara warnings de
  "GSAP target not found" en consola.

**Fix Sprint 5 (`packages/ui/src/animations/use-gsap.ts`)**:
- `useGsap({ plugins })` registra plugins solo dentro del `useEffect`, donde
  `typeof window !== 'undefined'` está garantizado.
- Idempotencia con `WeakSet<Plugin>` para que React Strict Mode no re-registre.
- Todo primitive cleanea con `return () => tween.kill()`.

**Regla preventiva**:
1. `import gsap from 'gsap'` está OK a top-level (core es SSR-safe). Plugins
   NO — siempre `import('gsap/ScrollTrigger')` dentro de `useEffect` o pasar
   el módulo a `useGsap({ plugins: [ScrollTrigger] })`.
2. Cualquier `gsap.to/from/fromTo/timeline` dentro de `useEffect` retorna un
   handle; el cleanup DEBE invocar `.kill()` (tween) o `.kill(true)`
   (timeline) — el booleano libera children.
3. Tests de animaciones SIEMPRE asertan `killMock` después de `unmount()`.

**Lección Sprint 6+**: animaciones sin cleanup son leak silencioso. Code review
rechaza primitives nuevos sin test de cleanup.

---

#### S5.6 `prefers-reduced-motion: reduce` SIEMPRE respetar (WCAG 2.3.3)

**Evidencia (Sprint 5, DS-1 iter 1 + MT-3 iter 1)**:
- WCAG 2.1 SC 2.3.3 (AAA pero adoptado como AA por nuestra rúbrica) exige que
  animaciones decorativas sean opt-out cuando el usuario tiene la preferencia
  del SO activada.
- Implementación naïf con CSS `@keyframes` ignora la preferencia salvo que se
  envuelva en `@media (prefers-reduced-motion: reduce)`. Implementación con
  GSAP necesita un guard explícito en JS — GSAP NO lee la media query por sí
  mismo.

**Fix Sprint 5 (`packages/ui/src/animations/use-gsap.ts`)**:
- Hook `usePrefersReducedMotion()` SSR-safe (default `false` en server).
- Listener `matchMedia('(prefers-reduced-motion: reduce)')` que actualiza si
  el user togglea OS al runtime.
- Cada primitive (`<GsapFade>`, etc.) usa `gsap.set(...)` (snap final) en
  lugar de `gsap.fromTo(...)` cuando `prefersReduced === true`.

**Regla preventiva**:
1. Cualquier animación NO esencial respeta la media query. Esenciales (loading
   spinner, indicador de progreso) pueden seguir corriendo pero deben ser
   sub-5Hz y no parpadear.
2. CSS global tiene un override blanket en `tokens.css`
   (`@media (prefers-reduced-motion: reduce) { *, *::before, *::after {
   animation-duration: 0.01ms !important; ... } }`); GSAP requiere guard JS
   adicional.
3. Tests visuales: spec render con MQ reduce-on debe asertar `gsap.set`
   (no `fromTo`).

**Lección Sprint 6+**: cualquier feature con animación pasa por checklist de
accesibilidad antes de merge. Auditor a11y (axe-core) NO captura este caso —
es responsabilidad del autor del PR.

---

#### S5.7 Brandable theming: NUNCA inline-style colores tenant — usar `setProperty` o `<style nonce>`

**Evidencia (Sprint 5, MT-3 iter 1 + DS-1 iter 1 — ADR-0013)**:
- Inyectar `style="background:#hex"` con valores tenant rompe la CSP `style-src
  'self'` y bypassa el whitelist de hosts (tenant podría inyectar
  `url(javascript:alert(1))` en un campo de URL libre).
- Aproximación correcta: `document.documentElement.style.setProperty(
  '--tenant-primary', validatedHex)` después de validación regex
  `/^#[0-9a-fA-F]{6}$/`. CSS consume la var.

**Fix Sprint 5 (`packages/ui/src/theme/brandable-tokens.ts`)**:
- `applyBrandableTheme({ primaryHex, accentHex, bgImageUrl })` valida hex con
  regex y URLs contra whitelist `*.cloudfront.net` / `cdn.segurasist.com` /
  `branding-assets-*.s3.amazonaws.com`.
- Cualquier valor que no pase la validación se silencia (no se setea la var,
  default tokens persisten). Defensa en profundidad anti CSS injection.
- `escapeUrl()` rechaza paréntesis / quotes / backslashes / semicolons antes
  incluso de `new URL()`.

**Regla preventiva**:
1. Tenant data NUNCA va a `style="..."` directo.
2. Hex con regex `/^#[0-9a-fA-F]{6}$/`. URLs con `new URL()` + host whitelist.
3. Si `<style nonce={n}>` es estrictamente necesario, generar el nonce
   per-request en middleware y exponerlo a la página vía header — coordinar
   con MT-1.

**Lección Sprint 6+**: review en cualquier PR que inyecte `style=` con
variable runtime. Default policy: rechazar y proponer CSS var.

---

#### S5.8 Catálogo Lordicon: pin a IDs verificados, NO referenciar IDs sin confirmación

**Evidencia (Sprint 5, DS-1 iter 1 + iter 2 — CC-15)**:
- IDs en `cdn.lordicon.com` pueden cambiar si Lordicon refresca un glyph
  (rebrand de la librería). Pinear sin verificar = breakage silencioso en
  prod (404 Lottie → fallback `<span>` vacío, sin error visible).
- Iter 1 dejó 20 IDs como `<TODO_ID_*>`; iter 2 resolvió 16 con verificación
  manual contra `https://lordicon.com/icons/system/`. 7 quedan como TODO con
  resolver script para Sprint 6.

**Fix Sprint 5 (`packages/ui/src/lord-icon/catalog.ts`)**:
- Cada entry confirmada lleva el ID hex de 8 chars. Las no confirmadas usan
  marker `<TODO_ID_*>`.
- `listUnresolvedIcons()` sirve de gate runtime + el playground page lista las
  pendientes para revisión visual.
- `scripts/fetch-lord-icons.ts` parsea `lordicon.com/icons/system/` y emite
  candidatos para review (no aplica el patch automáticamente).

**Regla preventiva**:
1. NUNCA copiar un ID Lordicon de un blog / Stack Overflow sin abrir
   `https://cdn.lordicon.com/<id>.json` en el browser y validar visualmente.
2. Cualquier nuevo icono pasa por el playground (`/dev/ui-playground`) antes
   de ser referenciado en producción.
3. Si Lordicon publica un mirror pago (`pro` o equivalente), pin a la
   versión `?v=...` cuando esté disponible — defensa contra glyph drift.

**Lección Sprint 6+**: el resolver script debe correr CI nightly para
detectar 404s preventivamente; alarmar Slack cuando un ID conocido devuelve
`status >= 400`. Owner DS-1 + DevOps.

---

## Sprint 4+ Reading Order (NEW agents/devs)

1. **TL;DR** (sección superior).
2. **Sección 1** — anti-patterns 1.1-1.11 (lectura obligatoria antes de cualquier PR).
3. **Sprint 5 anti-patterns S5.1-S5.8** (FE multi-tenant + Lordicons + GSAP + branding).
4. **Sección 2** — cheat-sheet con el snippet del tipo de cambio que estás haciendo.
5. **Sección 5** — checklist PR (marcar antes de pedir review).
6. **Sección 8** — lecciones del bundle más cercano a tu cambio.
7. **ADR correspondiente** si tu cambio toca bypass-rls (ADR-0001) o audit context (ADR-0002), o motion design (ADR-0012) / brandable theming (ADR-0013).
