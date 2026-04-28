# Developer Guide — SegurAsist (Sprint 4+)

> Guía consolidada post-auditoría exhaustiva (Sprint 3 closure → 15 Critical + ~25 High remediados).
> **Owner**: F10 (consolidador). **Audiencia**: agentes de desarrollo Sprint 4 en adelante.
> **Objetivo**: que las próximas fases incidan en menos errores aprovechando el aprendizaje del audit.

---

## TL;DR ejecutivo

| Métrica | Pre-Sprint-4 | Post-iter1+iter2 |
|---|---|---|
| 🔴 Critical bloqueantes | 15 | **0 cerrados** (todos los 15) |
| 🟠 High bloqueantes | 57+ | **~25 cerrados en este dispatch** (resto en backlog Sprint 5) |
| Compliance V2 (33 controles) | **89.4%** | **~95%** estimado (auditoría sigue los cierres) |
| Tests automatizados verdes | 1,094 | 1,094 + ~89 nuevos (F9) + 41 (F7) + 17 (F10) ≈ **1,240** |
| Façade coverage configs | 2 (admin + e2e setup) | **0** (eliminadas) |
| ADRs documentados | 0 | **2** (ADR-0001 bypass-rls, ADR-0002 audit-context) |
| Runbooks accionables | 4 TBDs | **15 completos** (RB-001..014) |

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

## Sprint 4+ Reading Order (NEW agents/devs)

1. **TL;DR** (sección superior).
2. **Sección 1** — anti-patterns 1.1-1.11 (lectura obligatoria antes de cualquier PR).
3. **Sección 2** — cheat-sheet con el snippet del tipo de cambio que estás haciendo.
4. **Sección 5** — checklist PR (marcar antes de pedir review).
5. **Sección 8** — lecciones del bundle más cercano a tu cambio.
6. **ADR correspondiente** si tu cambio toca bypass-rls (ADR-0001) o audit context (ADR-0002).
