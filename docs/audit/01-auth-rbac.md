# Audit Report — Auth + RBAC + JWT + MFA (A1)

## Summary

Área en estado sólido para Go-Live. El flujo OTP del portal asegurado está bien
diseñado (anti-enumeration estricto, hash sha256 con salt=sessionId, lockout
por CURP tras 5 rondas, comparación timing-safe, audit log). El `JwtAuthGuard`
es pool-aware (defensa en profundidad H3 contra escalamiento cross-pool), trae
MFA enforcement configurable (strict/log/off según NODE_ENV) y el branch S3-08
de tenant override valida UUID + status + fail-closed cuando falta el bypass
service. Las áreas débiles concentran en (1) cobertura unit testing del flujo
OTP marcada como `describe.skip` (gap declarado), (2) un acoplamiento de
`AuthService` a `PrismaBypassRlsService` que mete responsabilidad de lookup
data en un service de orquestación, y (3) un envío opcional de `audit.record`
que pierde fail-fast cuando el writer falla. Cero issues Critical, ninguna
vulnerabilidad explotable detectada.

## Files audited

15 archivos:

- `segurasist-api/src/modules/auth/auth.service.ts` (434 líneas)
- `segurasist-api/src/modules/auth/auth.controller.ts` (96 líneas)
- `segurasist-api/src/modules/auth/auth.module.ts` (26 líneas)
- `segurasist-api/src/modules/auth/dto/auth.dto.ts` (35 líneas)
- `segurasist-api/src/modules/auth/auth.service.spec.ts` (121 líneas)
- `segurasist-api/src/infra/aws/cognito.service.ts` (185 líneas)
- `segurasist-api/src/infra/aws/cognito.service.spec.ts` (252 líneas)
- `segurasist-api/src/common/guards/jwt-auth.guard.ts` (455 líneas)
- `segurasist-api/src/common/guards/jwt-auth.guard.spec.ts` (588 líneas)
- `segurasist-api/src/common/guards/roles.guard.ts` (64 líneas)
- `segurasist-api/src/common/guards/roles.guard.spec.ts` (134 líneas)
- `segurasist-api/src/common/guards/scopes.guard.ts` (47 líneas; deprecated)
- `segurasist-api/src/common/decorators/{roles,current-user,tenant,scopes}.decorator.ts`
- `segurasist-api/src/config/env.schema.ts` (vars auth-relevant)
- `segurasist-api/scripts/cognito-local-bootstrap.sh` (258 líneas)
- `segurasist-api/src/modules/email/templates/otp-code.{html,txt}.hbs`
- `segurasist-api/test/e2e/{auth,rbac}.e2e-spec.ts`
- `segurasist-api/test/integration/tenant-override.spec.ts`

## Strengths

1. **Anti-enumeration disciplinado** (`auth.service.ts:139-175`): `otpRequest`
   genera el `sessionId` ANTES del lookup del CURP y siempre devuelve la
   misma shape `{session, channel, expiresIn}` en los 4 caminos
   (rate-limited, lockout activo, CURP desconocido, CURP sin email). Un
   atacante no puede distinguir estados por payload, latencia previsible es
   el único side-channel residual.
2. **Defensa en profundidad pool-aware** (`jwt-auth.guard.ts:386-426` +
   `roles.guard.ts:51-53`): el guard valida el `aud` claim contra el
   client_id por pool y marca `req.user.pool`. El `RolesGuard` rechaza
   tokens del pool insured con `custom:role` admin-only — bloquea privilege
   escalation aunque cognito-local mis-routee claims.
3. **Lockout escalonado bien diseñado** (`auth.service.ts:96-100, 411-433`):
   5 rondas × 5 attempts = 25 intentos antes del silent block, con TTL del
   counter de rondas a 24h y reset al login exitoso. Balance correcto entre
   security y UX.
4. **OTP cripto-secure** (`auth.service.ts:347-355`): usa
   `crypto.randomInt(0, 1_000_000)` (uniform), `crypto.timingSafeEqual` para
   comparar hashes, sha256 con salt=sessionId (32 bytes random como salt
   único). `crypto.createHash('sha256')` es OK para OTP (no requiere
   resistencia a brute-force como passwords).
5. **MFA enforcement con escape hatch documentado**
   (`jwt-auth.guard.ts:51-54, 170-184, 452-455`): `MFA_ENFORCEMENT` env var
   con default por NODE_ENV (strict prod, log dev), warning visible en boot
   cuando `off`. Soporta los dos shapes de claim (`amr=['mfa']` y
   `cognito:mfa_enabled=true`).
6. **CURP redacted en logs**: `auth.service.ts:357-360` calcula
   `hashForLog(curp)` (sha256 truncado a 12 chars) para todos los logs del
   flow. Adicionalmente, `scrub-sensitive.ts:30` añade `curp` al set de
   keys redactadas en pino + AuditInterceptor.
7. **Tenant override S3-08 fail-closed** (`jwt-auth.guard.ts:300-365`):
   secuencia validación rigurosa (UUID format → bypass service disponible
   → tenant existe → tenant active), todos los caminos cierran con
   ForbiddenException o NotFoundException explícita; cuando falta el bypass
   service falla cerrado en lugar de ignorar el header.
8. **E2E coverage del RBAC matrix** (`rbac.e2e-spec.ts:215-276`): cubre los
   7 controllers principales × 5 roles con asserts simétricos (allowed →
   no 401/403; denied → 403 exacto). Incluye el caso de aislamiento del
   pool insured (`rbac.e2e-spec.ts:333-344`).

## Issues found

| ID | File:line | Severity | Category | Description | Recommendation |
|---|---|---|---|---|---|
| A1-01 | `auth.service.spec.ts:95-97` | High | Test-coverage | Tests unit de `otpRequest()` y `otpVerify()` están en `describe.skip` con `it.todo`. La lógica más crítica del flujo (rate limit per CURP, lockout escalonado, attemptsLeft decrement, hash mismatch path, anti-enum branches con CURP inexistente / sin email / con SMS fallback) NO tiene cobertura unit. La spec.ts dice que la cobertura "interim" es `test/integration/otp-flow.spec.ts` pero ese archivo NO existe (verificado: `find test -name '*otp*'` retorna 0 resultados). | Sprint 4: implementar 12-15 tests unit en `auth.service.spec.ts` cubriendo los 5 escenarios PRD §4 RF-401 (request OK, request CURP unknown silent, verify OK, verify wrong code decrement, verify exhausted → lockout). Mocks ya disponibles (jest-mock-extended está cargado). |
| A1-02 | `auth.service.ts:227-238, 313-323` | Medium | Pattern | El audit log usa `action: 'login'` con `resourceType: 'auth.otp.requested'` / `'auth.otp.verified'` como discriminador porque el enum `AuditAction` (Prisma `schema.prisma:153-164`) no incluye un literal OTP. La invocación es `void this.audit.record(...)` (fire-and-forget) — si el writer falla el evento se pierde silente. | Sprint 4: extender `AuditAction` enum a `otp_requested` / `otp_verified` (o renombrar a `auth_attempt`) con migration; o si se mantiene la sobrecarga semántica, al menos `await` el `record()` y log warning estructurado en el catch. La semántica actual rompe cualquier dashboard que filtre por `action='login'`. |
| A1-03 | `auth.service.ts:362-375, 411-433` | Medium | Structure | `AuthService` inyecta `PrismaBypassRlsService` y hace queries directas (`findInsuredByCurp`, segunda query en `bumpFailedRoundsForInsured`). Esto mezcla orquestación de auth con data access cross-tenant. La capa de "lookup insured by CURP" debería vivir en `InsuredsService` (ya tiene los repositorios y el bypass cliente), expuesta como un método explícito tipo `findInsuredCrossTenantByCurp(curp)` con su propio audit. | Sprint 4: extraer las 2 queries a `InsuredsLookupService` o `InsuredsService.findByCurpCrossTenant()`. Reduce el blast radius del módulo Auth y permite testear OTP sin importar Prisma en el spec. |
| A1-04 | `auth.service.ts:289-295` | Medium | Clarity | El uso de `redis.raw.set(key, val, 'KEEPTTL')` es un escape hatch porque el wrapper `RedisService.set` no expone el flag. El comentario explica el porqué pero el patrón "wrapper del wrapper bypass del wrapper" es frágil: si el wrapper cambia o se re-tipa, este call sigue funcionando pero pierde la observabilidad/metrics que sí tiene el wrapper. | Sprint 4: extender `RedisService` con `setKeepTtl(key, val)` o `update(key, val)` que internamente use `KEEPTTL`. Reemplazar el call directo a `raw`. |
| A1-05 | `auth.controller.ts:38-51` | Low | Clarity | El `@TenantThrottle({ ttl: 60_000, limit: 50 })` declarado en `otp/request` es **no-op en runtime** porque el endpoint es `@Public()` y no tiene `req.tenant` poblado. El comentario es claro al respecto, pero un dev nuevo puede asumir que el cap se aplica hoy. El cap real per-CURP (5/min) vive en `AuthService.checkCurpRateLimit`. | Sprint 4: o eliminar el `@TenantThrottle` decoradado (volver a poner cuando S5 implemente tenant resolution pre-auth), o cambiarlo por un comentario `// TODO S5:` con el snippet listo para descomentar. Mantener ambos crea ruido. |
| A1-06 | `cognito.service.ts:1` | Low | Maintainability | `eslint-disable @typescript-eslint/require-await` a nivel archivo desde Sprint 0 — los stubs `startInsuredOtp`/`verifyInsuredOtp` ahora throws `NotImplementedException` síncrono y el disable ya no es necesario (los `async` legítimos lanzan/awaitan). | Sprint 4: remover el disable header y verificar que tsc/eslint pasan. |
| A1-07 | `auth.service.ts:178-181` | Low | Maintainability | El SMS fallback a email es silente (`this.log.warn` único). El usuario que pidió SMS recibirá un email sin warning en la response. La response shape es idéntica (`channel: 'email'`) pero el cliente no tiene un signal claro de que su preferencia fue ignorada. | Sprint 4 / S5: agregar un campo `requestedChannel` en la response (con el valor original) para que el FE pueda mostrar "SMS no disponible aún, te enviamos email". |
| A1-08 | `auth.service.ts:103, 396-403` | Low | Maintainability | Magic number en `CURP_REQUESTS_PER_MINUTE = 5` y la ventana de 60s en `expire()`. Ambos son configurables vía env (`OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_LOCKOUT_SECONDS` SÍ están en `env.schema.ts`) pero estos dos quedaron hard-coded. | Sprint 4: añadir `OTP_REQUESTS_PER_MINUTE` y `OTP_RATELIMIT_WINDOW_SECONDS` al `EnvSchema` con defaults `5` y `60`. |
| A1-09 | `auth.service.ts:215-224` | Low | Pattern | Cuando SES falla, el OTP queda en Redis pero el usuario nunca lo recibe. Hoy se logguea pero se devuelve 200. El flujo de re-request funciona (rate-limit aparte), pero el `attemptsLeft=5` ya está consumido sin uso. | Sprint 4: en `try/catch` del SES `send`, si falla, hacer `redis.del` del session key para que el next request del mismo usuario re-genere uno nuevo en lugar de "consumir" la cuota silente. |
| A1-10 | `cognito.service.ts:84-94` | Low | Pattern | `startInsuredOtp` y `verifyInsuredOtp` son stubs que sólo lanzan `NotImplementedException` con un mensaje "usar AuthService.otpRequest". Mantener la API pública del service exportando métodos que no se pueden llamar es ruido. | Sprint 4: removerlos del service. Los tests `cognito.service.spec.ts:241-250` que verifican el throw también se borran. La defensa contra "fugas de responsabilidad" se mantiene porque el método ya no existe (compile-time fail). |
| A1-11 | `auth.controller.ts:78-94` | Low | Security | `GET /v1/auth/me` devuelve `id`, `email`, `role`, `scopes`, `mfa`, `tenant`, `pool`. No expone `cognitoSub` (bien) pero sí `id` (que ES `claims.sub`, ver `jwt-auth.guard.ts:192-197`, `id: claims.sub`). En la práctica `id === cognitoSub` para el AuthUser actual. `scrub-sensitive.ts:28-29` lista `cognitoSub` como sensitive, pero `id` (el mismo valor) se filtra en la response. | Sprint 4: documentar formalmente que `AuthUser.id === cognitoSub` y decidir si la response de `/me` debe enviar el `id` interno de `users` (FK en BD) en lugar del sub de Cognito. Hoy el portal/admin usa el sub para correlación lo cual es OK, pero el naming `id` es ambiguo. |
| A1-12 | `auth.module.ts:22` | Low | Structure | `JwtAuthGuard` y `RolesGuard` se declaran como providers en `AuthModule` y se exportan, pero NO están registrados como `APP_GUARD` global (`app.module.ts:114-126` solo registra `ThrottlerGuard`). Cada controller debe poner `@UseGuards(JwtAuthGuard)` manualmente — esto es propenso a olvidar. Verificado: el único controller sin `JwtAuthGuard` es `webhooks/ses-webhook.controller.ts` (legítimamente, valida firma SNS). Los 12+ controllers actuales sí lo tienen, pero un nuevo controller en Sprint 4 puede olvidarlo. | Sprint 4: registrar `JwtAuthGuard` y `RolesGuard` como `APP_GUARD` globales. Los endpoints públicos ya tienen `@Public()` (ver `auth.controller.ts:25, 35, 53, 63` y los webhooks). El `@Public()` decorator ya está integrado al guard (`jwt-auth.guard.ts:137-141`). Este cambio elimina la posibilidad de "controller nuevo sin auth". |

## Cross-cutting concerns

Findings que afectan a otras áreas (apend al feed):

- **A2 (multi-tenant + RLS)**: el `AuthService.findInsuredByCurp` y
  `bumpFailedRoundsForInsured` consumen `PrismaBypassRlsService` directo
  (cross-tenant). Si A2 modifica el shape del cliente bypass o el rol DB,
  el flujo OTP rompe silente (la branch `!isEnabled()` degrada a "CURP
  desconocido"). Coordinar.
- **A6 (audit + throttler)**: el `AuthService.otpRequest`/`otpVerify` registra
  audit con `action: 'login'` + `resourceType: 'auth.otp.*'` (sobrecarga
  semántica del enum `AuditAction`). Cualquier dashboard de A6 que filtre
  por `action` no puede distinguir OTP de admin login. Si A6 propone
  extender el enum, el cambio es trivial aquí (`auth.service.ts:233, 318`).
- **A6 (throttler)**: `@TenantThrottle` en `auth.controller.ts:45` es no-op
  hoy (el endpoint es `@Public` sin `req.tenant`). A6 debería verificar que
  el `ThrottlerGuard` ignore correctamente el `TENANT_THROTTLE_KEY` cuando
  `req.tenant` está ausente — si lanza error en lugar de skip, los
  endpoints públicos se rompen.
- **A7/A8 (frontend)**: la response de `/v1/auth/me` expone `id` que es
  `cognitoSub`. Si el frontend asume que `id` es la FK de `users.id` en BD
  (UUID v4), va a fallar — Cognito sub también es UUID pero distinto
  espacio. Documentar formalmente.
- **A10 (tests/DX)**: el `describe.skip` en `auth.service.spec.ts:95` hace
  referencia a `test/integration/otp-flow.spec.ts` como cobertura interim;
  ese archivo NO existe en el repo. A10 debería marcar este gap en el
  inventario de tests.

## Recommendations Sprint 4

1. **CRÍTICA UX-coverage**: implementar los unit tests de `otpRequest` y
   `otpVerify` (12-15 cases cubriendo PRD §4 RF-401). Sin esos tests,
   refactors del flow OTP arriesgan regresiones silentes en lockout y
   anti-enum (A1-01).
2. **Refactor estructural**: extraer `findInsuredByCurp` y la query del
   lockout reverse-lookup a `InsuredsService.findByCurpCrossTenant()`. Saca
   `PrismaBypassRlsService` del módulo Auth y respeta single responsibility
   (A1-03).
3. **Audit semántica**: agregar `otp_requested` / `otp_verified` al
   `AuditAction` enum o renombrar a `auth_attempt`; convertir el `void
   this.audit.record(...)` en `await` con error handling explícito para no
   perder eventos cuando el writer falla (A1-02).
4. **Hardening guards globales**: registrar `JwtAuthGuard` y `RolesGuard`
   como `APP_GUARD` en `app.module.ts`. Elimina el riesgo de un controller
   nuevo sin auth (A1-12).
5. **Cleanup deuda menor**: ① removerel decoradores deprecated del
   `@TenantThrottle` no-op (A1-05) ② quitar el `eslint-disable` del
   `cognito.service.ts:1` (A1-06) ③ borrar `startInsuredOtp` /
   `verifyInsuredOtp` stubs y sus tests (A1-10) ④ envasar `KEEPTTL` en
   `RedisService` (A1-04) ⑤ sumar `OTP_REQUESTS_PER_MINUTE` al EnvSchema
   (A1-08).
