# B1 — Auth + RBAC + JWT (2da vuelta)

> Auditor: Code Auditor independiente · READ-ONLY
> Fecha: 2026-04-25
> Insumo: `_findings-feed.md` (68 entries de los 10 agentes 1ra vuelta)
> Reporte 1ra vuelta: `docs/audit/01-auth-rbac.md` (12 issues, 0 Critical)

## Resumen ejecutivo

Re-revisado con conocimiento cross-cutting de los 9 reportes restantes, aparecen **3 hallazgos NUEVOS en categoría Critical / High** que la 1ra vuelta no detectó porque solo se ven en correlación: (1) `INSURED_DEFAULT_PASSWORD` con default literal `'Demo123!'` que el env schema acepta en producción; (2) flujo OTP nunca persiste `insureds.cognito_sub`, dejando rotos los endpoints `findSelf` / `certificates/mine` / `claims/me` para todo insured nuevo; (3) `setSessionCookies` (`packages/auth/src/session.ts`) con `sameSite='lax'` impacta TAMBIÉN el `auth.service` admin local-login porque comparte la cookie name con NextAuth callback (admin tiene dos vías de seteo de cookie con harden distinto). El reporte 1ra vuelta también necesita reconciliación con A2 (acoplamiento de PrismaBypass), A6 (audit enum), A8 (cognito-local seed sin `given_name`) y A10 (gap de tests OTP).

## Findings nuevos (no detectados en 1ra vuelta)

| ID | File:line | SEV | Categoría | Descripción | Fix sugerido |
|---|---|---|---|---|---|
| **A1v2-01** | `segurasist-api/src/config/env.schema.ts:154` | **Critical** | Security | `INSURED_DEFAULT_PASSWORD: z.string().min(8).default('Demo123!')`. El default literal aplica EN PRODUCCIÓN si la env var no está configurada (no hay `.superRefine` que la bloquee como sí lo hay para `COGNITO_ENDPOINT` en líneas 169-183). Si el deployment olvida setear la var en App Runner / Secrets Manager, el sistema arranca con `Demo123!`. Si producción reusa la misma password en el pool insured de Cognito (escenario verosímil durante migration / first deploy), un atacante puede llamar `AdminInitiateAuth` directamente con email + `Demo123!` y bypassear el flujo OTP completo (que es el factor real de auth). Adicional: la var NO está documentada en `.env.example` (busqué `Demo123\|INSURED_DEFAULT_PASSWORD` → 0 matches). Default silente. | (1) Quitar el `.default('Demo123!')` y marcar la var como `optional()` con `.refine(...)` que en `NODE_ENV=production` exija `min(20)` y rechace valores conocidos (`Demo123!`, `Password123!`, etc.). (2) Documentar en `.env.example` con comentario "REQUIRED in prod, generate via `openssl rand -base64 24`". (3) Auditar el bootstrap de cognito Production: las cuentas insured deben tener una password aleatoria por usuario, NO una compartida — en MVP justifica un sistema-password compartido solo si la password vive únicamente en backend y NUNCA en Cognito-side recovery flows. (4) Mover a Secrets Manager con rotación. |
| **A1v2-02** | `segurasist-api/src/modules/auth/auth.service.ts:300-326` | **High** | Pattern / Bug | `AuthService.otpVerify` consigue `AuthTokens` de Cognito (line 308-311) pero **NO persiste `insureds.cognito_sub`**. Sin embargo, `InsuredsService.findSelf` (`insureds.service.ts:672`), `CertificatesService.findMine` (`certificates.service.ts:202`) y `ClaimsService.createSelf` (`claims.service.ts:82`) buscan al insured por `where: { cognitoSub: user.cognitoSub }`. La columna `insureds.cognito_sub` es NULL para insureds creados vía CSV batch (no hay flujo que la backfille post-OTP). Resultado E2E: insured logea con OTP, recibe token válido, pero TODAS las llamadas autenticadas del portal devuelven 404 ("Asegurado no encontrado"). El bug se enmascara hoy porque (a) en dev `prisma db seed` lo backfillea explícitamente (lines 179-201), y (b) `apps/portal/app/api/proxy` tiene el bug A8-01 (cookie wrong) que devuelve 401 antes de llegar al backend. Cuando A8-01 se cierre, este bug aparece como regresión de "auth funciona pero portal devuelve 404 en todo". | En `AuthService.otpVerify`, después de `cognito.loginInsuredWithSystemPassword(...)` y antes del audit, hacer un upsert defensivo: `await prismaBypass.client.insured.update({ where: { id: parsed.insuredId }, data: { cognitoSub: <decoded sub from idToken> } })`. El `idToken` decodificado contiene el `sub` del pool insured. Idempotente — re-run del OTP verify sobre el mismo insured no causa cambios. Edge case: si dos insureds del mismo tenant comparten email (no debería, pero fix-defensivo), el `partial unique index` en `cognito_sub` previene drift. Test integration nuevo: `otp-flow.spec.ts` que no existe (gap A10-02). |
| **A1v2-03** | `segurasist-web/packages/auth/src/session.ts:21-38` + `apps/admin/app/api/auth/local-login/route.ts` | **High** | Security | A7-01 reportó que `setSessionCookies` (sameSite='lax') es usado por el callback NextAuth admin. Pero falta señalar: la MISMA cookie name (`SESSION_COOKIE = sa_session`) se setea por DOS rutas distintas con políticas distintas: (a) `/api/auth/[...nextauth]/callback` → `setSessionCookies` (sameSite='lax', secure: true HARD) y (b) `/api/auth/local-login` → `buildSessionCookie` de `apps/admin/lib/cookie-config.ts` (sameSite='strict', secure condicional por allowlist). Si un usuario tiene ambas cookies seteadas (login local + SSO Cognito), la última ganada manda. El estado del browser puede tener una cookie `sa_session` con sameSite mixto entre sesiones. Adicional: `setSessionCookies` setea `secure: true` siempre — en dev http://localhost rompe el set silente (browser ignora la cookie); funciona si el callback no se usa en dev (que es el caso, pero el código lo permitiría). | Migrar `packages/auth/src/session.ts` a importar `buildSessionCookie` o exponer un helper común. Cambiar `sameSite: 'lax'` → `'strict'` y `secure: true` → secure conditional por NODE_ENV allowlist (paridad con admin/portal). Coordinado con A7-03 (consolidar a `packages/security/`). Tests: cubrir el caso "cookie ya seteada por local-login + callback Cognito sobreescribe" en e2e. |
| **A1v2-04** | `segurasist-api/src/modules/webhooks/ses-webhook.controller.ts:67-69` | **High** | Security | A4-25 reportó "POST /v1/webhooks/ses sin throttle (DoS trivial)". Cross-cutting con tu área: el endpoint es `@Public()` (línea 67) y comparte el patrón con `auth.controller.ts:25` (login), `auth.controller.ts:35` (otp/request), `auth.controller.ts:53` (otp/verify), `auth.controller.ts:63` (refresh). Auth tiene `@Throttle({ttl:60_000,limit:5})` en cada uno; el webhook tiene NADA. Pattern check (grep recursivo): los 4 endpoints `@Public` de auth llevan `@Throttle`; los certs `@Public` (verify/:hash) también; el webhook es el único `@Public` SIN throttle. Es un gap aislado pero pertenece a la categoría "@Public sin defensa" del cross-cutting. | (a) Aplicar `@Throttle({ttl:60_000,limit:60})` al webhook (60/min es razonable para SES bursts legítimos). (b) Considerar un `@Throttle` por IP fuente del SNS topic ARN (custom key) para que un atacante no agote el cap legítimo. (c) Documentar en un comentario explicito por qué tal endpoint cualquier fuera del whitelist debe llevar throttle. |
| **A1v2-05** | `segurasist-api/src/modules/auth/auth.service.ts:296-298` | **Medium** | Security / Pattern | El error de OTP incorrecto incluye `Te quedan ${attemptsLeft} intento(s)`. Combinado con `checkSessionRateLimit` (5/min per session) y el `attemptsLeft` que arranca en 5, el atacante puede aprender el counter exacto vía mensajes de error. La defense-in-depth correcta sería devolver "Código incorrecto" sin contador hasta que el counter llegue a 1 (y solo entonces decir "último intento"). Adicional: el controller responde con `UnauthorizedException` que el `HttpExceptionFilter` traduce a un body Problem Details que sigue conteniendo el mensaje completo en `detail` — es UI-friendly pero también attacker-friendly. | Cambiar el mensaje a "Código incorrecto. Intenta nuevamente." cuando `attemptsLeft >= 2`, y solo a "Último intento. Si fallás se invalidará el código" cuando `attemptsLeft === 1`. El frontend ya renderiza el contador desde `expiresIn` y el countdown del session — el counter exacto no aporta UX pero filtra estado. |
| **A1v2-06** | `segurasist-api/src/modules/auth/auth.controller.ts:78-94` | **Medium** | Pattern | `/v1/auth/me` retorna `email, role, scopes, mfa, tenant, tenantId, pool` pero NO retorna `fullName` ni `given_name`. El portal asegurado (A8-04, A8-16) muestra "Hola, insured.demo" como fallback porque cognito-local NO emite `given_name`. Coordinar: si `/me` retorna `fullName` (consultando `users` por sub para admin O `insureds` por sub para insured), el portal puede usarlo como source-of-truth en lugar de decodificar el JWT. Adicional: el endpoint NO retorna `cognitoSub` por hardening pero sí retorna `id` que ES el sub (A1-11 ya identificado) — A7 ya está consumiendo `body.email` con tres fallbacks legacy (`auth-server.ts:40-48`, A7-12) que se pueden simplificar si el contrato se estabiliza. | Agregar `fullName` (string) al response shape de `/me`. Para admin: lookup en `users` por `cognitoSub`. Para insured: lookup en `insureds` por `cognitoSub`. Ambos vía `prismaBypass` (read-only, sin tenant context). Coordinar con A7-12 para limpiar fallbacks `body.user.*` / `body.data.*`. Tests: ampliar `auth.e2e-spec.ts` para validar `fullName` en cada rol. |
| **A1v2-07** | `segurasist-api/scripts/cognito-local-bootstrap.sh:91-100,151-162` | **Medium** | DX / Pattern | El bootstrap define el `--schema` del pool con `email, tenant_id, role` (líneas 95-97) pero NO declara `given_name`. Resultado: en dev local, el JWT del insured emitido por cognito-local NO trae `given_name` (gap A8-04). El portal cae a "Hola, insured.demo" (split del email). El admin no se ve afectado porque tiene `lib/auth-server.ts.fetchMe()` que consulta el backend. Para que el portal pueda usar `given_name` directo del JWT (más rápido que `/me`), hay que: (a) sumar `Name=given_name,...` al schema del pool insured; (b) sumar `Name=given_name,Value=María` al `ensure_user` del insured; (c) opcionalmente incluir `name=family_name` para apellido. | Modificar `cognito-local-bootstrap.sh:96-99` agregando `Name=given_name,AttributeDataType=String,Required=false,Mutable=true,DeveloperOnlyAttribute=false` y `Name=family_name,...`. En `ensure_user` para `insured.demo@mac.local`, agregar `Name=given_name,Value=María` (consistente con el `fullName` del seed). Documentar en `LOCAL_DEV.md` la decisión: en prod (Cognito real), `given_name` se debe poblar via UserMigration Lambda o admin-update-user-attributes desde el flujo de invitación insured. |
| **A1v2-08** | `segurasist-api/src/common/interceptors/audit.interceptor.ts:49-58` + `auth.service.ts:226-238,313-323` | **Medium** | Audit / Pattern | Doble emisión de audit para auth flows: el `AuditInterceptor` (global APP_INTERCEPTOR) detecta `/auth/login` y mapea a `action='login'` con `resourceType='auth'` (extractResourceType) — escribe a pino + audit_log. Adicionalmente, `AuthService.otpRequest`/`otpVerify` invocan manualmente `audit.record(...)` con `resourceType='auth.otp.requested'` / `'auth.otp.verified'`. Para `/v1/auth/login`: solo el interceptor emite (no hay manual). Para `/v1/auth/otp/request`: ambos emiten — el interceptor con `action='create' resourceType='auth'` (no matchea el if `endsWith('/auth/login')` línea 56), y el manual con `action='login' resourceType='auth.otp.requested'`. Resultado: dashboards que filtren por `action='login'` ven SOLO el manual, los que filtren por `resourceType='auth'` ven dos rows distintos. Inconsistente. Cross-cutting con A6-01 (SENSITIVE_KEYS duplicado entre interceptor + util). | Convergencia recomendada: extender `methodToAction()` para mapear también `endsWith('/auth/otp/request')` → `'login'`, `endsWith('/auth/otp/verify')` → `'login'`. Eliminar el `audit.record` manual del `AuthService` para evitar el double-write — la información de `sessionPrefix` y `channel` debería entrar via `payloadDiff` que YA construye el interceptor (con redact). Si se necesita preservar el `audit.action='login'` específicamente, extender el enum `AuditAction` (Prisma) con `otp_requested` / `otp_verified` y removerlos del manual (A1-02 ya lo identificó pero como issue separado; en v2 se ve la convergencia). |
| **A1v2-09** | `segurasist-api/src/common/guards/jwt-auth.guard.ts:188-260` | **Low** | Pattern / Coverage | `applyTenantOverride` (líneas 300-365) es el ÚNICO punto donde el JwtAuthGuard hace `prismaBypass.client.tenant.findUnique` directo. Patrón análogo al `AuthService.findInsuredByCurp` que A1-03 sugirió mover a un service. Pero el JwtAuthGuard tiene una restricción adicional: corre antes de cualquier service (es el guard), no puede inyectar un service que dependa de él circularmente. Por eso aquí está OK pero **el patrón de duplicar lookup BYPASSRLS en guards** debería estar documentado / centralizado. Coordinación con A2 (multi-tenant): el `PrismaBypassRlsService` tiene 3 consumidores principales (`AuthService`, `JwtAuthGuard`, `SesWebhookController`) — todos válidos. Si A2 propone un wrapper de `findUnique` que enforce timeouts/rate-limits para cross-tenant lookups, este guard se beneficia. | (a) Documentar en `prisma-bypass-rls.service.ts` los 3 consumidores legítimos con justificación. (b) Agregar timeout explícito (e.g. `Promise.race(query, sleep(2000))`) al `applyTenantOverride` para evitar que un `tenants` table scan (futuro caso patológico) bloquee el request indefinidamente. Hoy hereda el global timeout 15s de `TimeoutInterceptor` pero ese aplica al handler, no al guard. (c) Crear un test integration "tenant-override con tenant inactivo" — el e2e existente `tenant-override.e2e-spec.ts` cubre los happy paths pero no encontré el caso "status=suspended". |
| **A1v2-10** | `segurasist-api/src/modules/auth/auth.controller.ts:38-51` + cross-cut con `webhooks/ses-webhook.controller.ts` y `insureds/exports` (A6-49) | **Low** | Pattern | El `@TenantThrottle({ttl:60_000,limit:50})` en `auth.controller.ts:45` es no-op runtime sobre `/auth/otp/request` (`@Public` sin `req.tenant`) — A1-05 ya lo identificó como cleanup. En 2da vuelta veo el patrón cross-cutting: A6-49 reportó que `/v1/insureds/export` tiene `@Throttle` user-IP pero NO `@TenantThrottle`. Hay 3 patrones inconsistentes: (i) Auth: `@Throttle` + `@TenantThrottle` no-op declarativo; (ii) Insureds export: `@Throttle` solo, sin `@TenantThrottle`; (iii) Audit verify-chain: ni uno ni otro (A6-03). Cada uno tiene racional distinto pero el desarrollador nuevo no tiene una guía. | Documentar en `throttler.decorators.ts` (header comment) la matriz de uso esperada: `@Throttle` siempre, `@TenantThrottle` cuando el endpoint es post-auth y opera sobre datos del tenant, ambos cuando se quieren defensas en capa. Comentario en cada `@Public` del repo justificando por qué tiene/no tiene `@TenantThrottle`. Fix sugerido también para A6-49 al mismo tiempo. |

## Patrones convergentes confirmados

### 1. **`@Public` endpoints sin defensas consistentes** (cross A1, A4, A6)

Lista completa de `@Public` en backend (verificado via grep):
- `auth.controller.ts:25` (login) — `@Throttle(5/60s)` ✓
- `auth.controller.ts:35` (otp/request) — `@Throttle(5/60s)` + `@TenantThrottle` no-op ✓
- `auth.controller.ts:53` (otp/verify) — `@Throttle(5/60s)` ✓
- `auth.controller.ts:63` (refresh) — **SIN `@Throttle`** ⚠️
- `certificates.controller.ts:36` (verify/:hash) — `@Throttle(60/60s)` ✓
- `webhooks/ses-webhook.controller.ts:67` (POST ses) — **SIN `@Throttle`** ⚠️ (A4-25)

Hay 2 `@Public` sin throttle: `/auth/refresh` y `/webhooks/ses`. El refresh es brute-forceable (un atacante con un refresh token leakeado puede generar tokens de acceso indefinidamente sin rate-limit). Es un finding NUEVO (no reportado en 1ra vuelta).

→ **A1v2-NEW** (debería ser High, lo agrego al index): `auth.controller.ts:63` `/v1/auth/refresh` `@Public` sin `@Throttle`. Refresh tokens robados (SCP S3 leakage, XSS, malware) son explotables hasta que Cognito los revoque (default 30 días). Sin rate-limit, un atacante puede generar 100+ access tokens por segundo. Aplicar `@Throttle({ttl:60_000,limit:10})`.

### 2. **Cookie wiring fragmentado** (cross A1, A7, A8)

Confirmado pattern de **3 wirings inconsistentes** en area auth:
- `packages/auth/src/session.ts` setea sa_session con `sameSite=lax`, `secure=true` hard.
- `apps/admin/lib/cookie-config.ts` setea sa_session con `sameSite=strict`, `secure` condicional por allowlist.
- `apps/portal/lib/cookie-config.ts` setea sa_session_portal con `sameSite=strict`, `secure` condicional.
- `apps/portal/app/api/proxy` LEE `sa_session` (admin) por bug A8-01 → debería leer `sa_session_portal`.

El admin tiene 2 caminos para llegar a sa_session (callback NextAuth + local-login) con políticas distintas. El portal tiene 1 camino (otp-verify) pero su proxy se equivoca de cookie.

→ Confirma A1v2-03 y refuerza recomendación de **consolidar `packages/security/cookie.ts`** como única fuente.

### 3. **Audit log con sobrecarga semántica del enum** (cross A1, A6, A2)

A1-02 (1ra vuelta) reportó que `auth.service` usa `action='login' resourceType='auth.otp.*'` para no extender el enum. A6-01 reportó duplicado de `SENSITIVE_KEYS`. Además, A1v2-08 ahora muestra que el `AuditInterceptor` también emite por las mismas rutas con un mapeo diferente. **El audit del flow OTP termina escribiendo 2 rows o 0 dependiendo del path**. Refuerza la urgencia del fix A1-02 + agregar mapping del interceptor.

### 4. **Acoplamiento `PrismaBypassRlsService` en módulos no-data** (cross A1, A2)

A1-03 reportó que `AuthService` inyecta `PrismaBypassRlsService` directo. A2 detalló el patrón consistente cross-tenant. En v2: el `JwtAuthGuard` también lo inyecta (línea 106). Total: 3 consumidores fuera del módulo Tenants/Users (`AuthService`, `JwtAuthGuard`, `SesWebhookController`). Cada uno con su propia query → drift inevitable si el shape del client cambia.

→ Recomienda A2 documentar en `prisma-bypass-rls.service.ts` los consumidores legítimos.

### 5. **Tests OTP fantasma** (A1, A10)

A10-02 confirmó: el `describe.skip` en `auth.service.spec.ts:95` referencia `test/integration/otp-flow.spec.ts` que NO existe. Cero cobertura unit del flow OTP que es el factor de auth real para el portal asegurado. RF-401 está sin tests reales en main. La convergencia con el bug A1v2-02 (cognito_sub no se persiste) es directa: con tests integration adecuados, el bug se hubiera detectado antes.

## Reconciliación con 1ra vuelta

| Issue 1ra vuelta | Estado en v2 | Cambio sugerido |
|---|---|---|
| **A1-01** (otpRequest/Verify sin tests) | **Confirmado y agravado** | Sube a Critical: el bug A1v2-02 (cognito_sub no persiste) es el tipo de regresión que solo tests integration detectan. Recomendación 1ra vuelta sigue válida. |
| **A1-02** (audit enum overload) | **Confirmado + refuerzo** | Convergencia con A1v2-08 (double-write desde interceptor). Subir a High por el efecto de drift en dashboards A6. Fix combinado: extender enum + remover audit manual + extender mapping del interceptor. |
| **A1-03** (PrismaBypass acoplado a AuthService) | **Confirmado + ampliado** | A1v2-09 muestra que el patrón se replica en JwtAuthGuard (tenant-override). Ya no es solo AuthService; el problema es de "guards/services con lookups cross-tenant directo". Mantener Medium. |
| **A1-04** (KEEPTTL bypass del wrapper) | **Sin cambio** | Cleanup deuda menor. |
| **A1-05** (TenantThrottle no-op) | **Confirmado + cross-cut** | A1v2-10 lo enmarca en patrón cross-cutting con A6-49 (insureds/export sin TenantThrottle) y A6-03 (verify-chain sin nada). Mantener Low pero subir prioridad de doc. |
| **A1-06** (eslint-disable cognito) | **Sin cambio** | Cleanup. |
| **A1-07** (SMS fallback silente) | **Sin cambio** | UX gap, no security. |
| **A1-08** (CURP_REQUESTS_PER_MINUTE hard-coded) | **Confirmado** | grep validó que NO existe `OTP_REQUESTS_PER_MINUTE` en env.schema. |
| **A1-09** (SES falla deja session en Redis) | **Sin cambio** | Pattern UX. |
| **A1-10** (cognito stubs no implementados) | **Sin cambio** | Cleanup. |
| **A1-11** (`/me` expone id=cognitoSub) | **Confirmado + amplía A1v2-06** | El response de `/me` necesita `fullName` además de aclarar el contrato del `id`. |
| **A1-12** (JwtAuthGuard NO global) | **Confirmado + cross-cut** | A1v2-04 muestra que el SES webhook (A4) ES el único endpoint sin auth NEW que aparece sin throttle — un controller similar Sprint 4 puede olvidarse de `@Public()` Y `@Throttle`. Reforzar la recomendación: APP_GUARD global + lint rule "controller sin `@UseGuards` ni `@Public` falla CI". |

### Downgrades / Upgrades de severidad propuestos

- **A1-01 sube** de High → Critical (bloqueante de Go-Live cuando A1v2-02 se descubra en QA).
- **A1-02 sube** de Medium → High (impacto convergente con A1v2-08).
- **A1-12 sube** de Low → Medium (riesgo aumenta tras descubrir A1v2-04).

## Recomendaciones para reporte ejecutivo final

### Top 5 fixes (con código sugerido + tests requeridos)

#### 1. **(Critical) Eliminar default `'Demo123!'` de `INSURED_DEFAULT_PASSWORD`** (A1v2-01)

```ts
// segurasist-api/src/config/env.schema.ts:154
INSURED_DEFAULT_PASSWORD: z.string().min(20).optional(),  // sin default

// En el .superRefine global, agregar:
if (env.NODE_ENV === 'production' && !env.INSURED_DEFAULT_PASSWORD) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['INSURED_DEFAULT_PASSWORD'],
    message: 'INSURED_DEFAULT_PASSWORD es obligatorio en producción y debe venir de Secrets Manager.',
  });
}
const FORBIDDEN_DEFAULTS = ['Demo123!', 'Password123!', 'Admin123!', 'CHANGE_ME'];
if (env.NODE_ENV === 'production' && FORBIDDEN_DEFAULTS.includes(env.INSURED_DEFAULT_PASSWORD ?? '')) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['INSURED_DEFAULT_PASSWORD'], message: 'Password placeholder detectado en producción.' });
}
```
**Tests requeridos**: `env.schema.spec.ts` con casos: (a) prod sin var → reject; (b) prod con `'Demo123!'` → reject; (c) prod con random 24-char → ok; (d) dev con var ausente → ok (sigue defaulteando para no romper tests).

#### 2. **(High) Backfillear `insureds.cognito_sub` en `otpVerify`** (A1v2-02)

```ts
// segurasist-api/src/modules/auth/auth.service.ts after line 311
const decoded = JSON.parse(Buffer.from(tokens.idToken!.split('.')[1], 'base64url').toString('utf8'));
const cognitoSub = decoded.sub as string;
if (cognitoSub && this.prismaBypass.isEnabled()) {
  await this.prismaBypass.client.insured.update({
    where: { id: parsed.insuredId },
    data: { cognitoSub },
  }).catch((err) => {
    // No bloqueamos el login: log warning para investigar el insured.
    this.log.warn({ insuredId: parsed.insuredId, err: String(err) }, 'cognitoSub backfill failed; portal /me devolverá 404 hasta resolverse');
  });
}
```
**Tests requeridos**: integration `test/integration/otp-flow.spec.ts` (NO EXISTE — A10-02): (a) insured con `cognito_sub=NULL` → otpVerify ok → check db row `cognito_sub` populated; (b) re-run otpVerify mismo insured → no falla (idempotente). Tras el fix, des-skipear `apps/portal/test/unit/components/home-page.test.tsx` flows que se brincan por `useInsuredSelf` 404.

#### 3. **(High) Throttle al `/v1/auth/refresh`** (Patrón convergente § 1)

```ts
// segurasist-api/src/modules/auth/auth.controller.ts:63
@Public()
@Throttle({ ttl: 60_000, limit: 10 })  // <-- AGREGAR
@Post('refresh')
```
**Tests requeridos**: e2e `auth.e2e-spec.ts` con 11 requests rápidos → 11º recibe 429.

#### 4. **(High) Consolidar `packages/security/cookie.ts`** (A1v2-03 + A7-01 + A7-03 + A8-01)

Plan de migración:
1. Crear `segurasist-web/packages/security/src/cookie.ts` con `buildSessionCookie` (sameSite='strict', secure por allowlist).
2. Re-exportar de `packages/auth/src/session.ts` y deprecar `setSessionCookies` ahí.
3. Cambiar `apps/admin/app/api/auth/[...nextauth]/route.ts` para usar `buildSessionCookie` directamente (no via `setSessionCookies`).
4. Cambiar `apps/admin/lib/cookie-config.ts` y `apps/portal/lib/cookie-config.ts` para re-exportar del package.
5. **Aplicar fix A8-01 también**: `apps/portal/app/api/proxy/[...path]/route.ts` debe importar `PORTAL_SESSION_COOKIE`.

**Tests requeridos**: existentes `cookie-config.test.ts` migrados al package + nuevo test e2e `apps/portal/test/api/proxy.test.ts` que verifique `Authorization: Bearer <portal-token>` se forwardea.

#### 5. **(Medium) Implementar `otp-flow.spec.ts` integration + extender enum AuditAction** (A1-01 + A1-02 combinados)

Crear `segurasist-api/test/integration/otp-flow.spec.ts` (gated por env `OTP_FLOW_INTEGRATION=1` con LocalStack/Mailpit/Redis disponibles):

```ts
// Casos:
// 1. Happy path: request → email recibido (Mailpit) → verify → tokens
// 2. Anti-enum: request CURP unknown → 200 idéntico, pero email NO se envía
// 3. Lockout escalonado: 5 verifies fallidos × 5 sessions = lockout activado
// 4. Backfill cognito_sub (covers A1v2-02 fix)
// 5. SMS fallback silente
// 6. Email failure deja session en Redis (covers A1-09)
```

Extender enum:
```sql
-- prisma/migrations/20260428_audit_action_otp/migration.sql
ALTER TYPE audit_action ADD VALUE 'otp_requested';
ALTER TYPE audit_action ADD VALUE 'otp_verified';
```
+ Update `auth.service.ts:233,318` y `audit.interceptor.ts:methodToAction` para mapear los endpoints.

**Tests requeridos**: ampliar `audit.interceptor.spec.ts` para validar que `/v1/auth/otp/request` mapea a `otp_requested`.

## Notas adicionales (out-of-scope-ish)

- **M3 `@Scopes` deprecated**: verificado con grep — NINGÚN controller lo usa hoy. `scopes.guard.ts` está bien documentado como Fase 2 placeholder. Mantener.
- **M4 `COGNITO_ENDPOINT` runtime**: validado via Zod superRefine al boot. No re-validado en runtime (env loaded inmutable post-boot). Adecuado.
- **L4 magic bytes**: A6-13 reportó que la heurística CSV permite UTF-8 multibyte sin validar secuencia. Es **upload-only** (no aplica a download integrity de certs). Tu reporte 1ra vuelta no lo cubría — out of scope auth.

## Cross-cutting concerns para apend al feed

```
[A1v2] 2026-04-25 21:00 Critical env.schema.ts:154 — INSURED_DEFAULT_PASSWORD default 'Demo123!' aplica en producción si la env var falta. // Impacta A9 (Secrets Manager required), A1 (auth bypass directo en Cognito si misma password se usa pool insured prod).
[A1v2] 2026-04-25 21:00 High auth.service.ts:300-326 — otpVerify NO persiste insureds.cognito_sub; findSelf/certificates/mine/claims/me devuelven 404 para insureds nuevos. // Impacta A5 (queries por cognitoSub), A4 (cert preview), A8 (portal hooks 404 silente tras fix de A8-01).
[A1v2] 2026-04-25 21:00 High auth.controller.ts:63 — POST /v1/auth/refresh @Public sin @Throttle; refresh tokens robados explotables sin rate-limit. // Impacta A6 (throttler global pattern), A4 (token misuse).
[A1v2] 2026-04-25 21:00 Medium auth.service.ts:296 — error message expone attemptsLeft exact; permite scoping del lockout. // UX vs security tradeoff documentado.
[A1v2] 2026-04-25 21:00 Medium audit.interceptor.ts:49-58 — methodToAction NO mapea /auth/otp/* explícitamente; combinado con audit.record manual de AuthService → double-write o miss. // Impacta A6 (dashboards), A1-02 (audit enum extension).
```
