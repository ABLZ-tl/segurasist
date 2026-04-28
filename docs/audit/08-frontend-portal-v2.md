# Audit Report — Frontend portal asegurado (A8 — 2da vuelta)

Re-revisión enfocada en (1) confirmar el Critical A8-01, (2) buscar patrones replicados en otros consumers, (3) cruzar con findings de A1/A4/A6/A7/A10 reportados durante la 1ra vuelta. Repo en READ-ONLY; los hallazgos nuevos NO sobrescriben los de v1, los complementan.

## Resumen 2da vuelta

- **A8-01 (Critical) sigue presente** en `apps/portal/app/api/proxy/[...path]/route.ts:2,13`. El bug NO se ha replicado en otros consumers del portal: `middleware.ts`, `lib/insured-session.ts`, `app/(app)/layout.tsx` y los 3 route handlers de auth (`portal-otp-request`, `portal-otp-verify`, `portal-logout`) usan `PORTAL_SESSION_COOKIE` (`sa_session_portal`) correctamente. El bug está aislado al proxy.
- **CSP `frame-src` faltante** se confirma como cross-cutting: `apps/admin/next.config.mjs:36-47` tiene la **MISMA gap** que `apps/portal/next.config.mjs:20-31` — ambos caen a `default-src 'self'` cuando aparezca un iframe S3. Hoy admin no renderiza iframes, pero el día que el cert detail page admin lo haga (Sprint 5 plausible), regresará el mismo bug.
- **Cookie-config + origin-allowlist son funcionalmente byte-idénticos** entre admin y portal (A7-58 lo reportó). Confirmo el path para consolidar a `packages/security/` o `packages/auth/` con dos exports/factories parametrizados (port 3001/3002, env var name).
- **`given_name` ausente en cognito-local-bootstrap** confirma A8-16 + cruza con A1: `segurasist-api/scripts/cognito-local-bootstrap.sh:151-155` arma `attrs_create=(email, email_verified, custom:role[, custom:tenant_id])` — falta `Name=given_name,Value=...`. Atributo standard Cognito (no `custom:`).
- **Lighthouse CI mira la URL equivocada**: `apps/portal/lighthouserc.js:6` apunta a `http://localhost:3001/` (admin) en lugar de `:3002/` (portal). El `pnpm lighthouse` del portal o falla (no hay puerto 3001 si el script `start` levanta 3002) o mide la app admin si admin está corriendo. Hallazgo NUEVO no listado en v1.
- **`portal-logout` NO usa `buildSessionCookie()`** para expirar las cookies — drift menor del patrón hardening (M6+L3). No es vulnerable hoy (maxAge:0 expira igual) pero rompe el contrato "todo session-cookie pasa por el helper".
- **El portal NO expone webhooks** (no hay `app/api/webhooks/*`) — A4-04 (SES webhook sin throttle) no aplica al portal.
- **El portal NO surface `hash` del certificado** — `CertificateMine` en `packages/api-client/src/hooks/certificates.ts:21-28` solo expone `{url, expiresAt, certificateId, version, issuedAt, validTo}`. A4-01 (hash provisional persistido) **no sale a UX del asegurado**.
- **Mutación POST /v1/claims SÍ se audita correctamente**: `claims.service.ts:114-126` invoca `auditWriter.record({action:'create', resourceType:'claims', ...})`. A6 interceptor + service-side audit están alineados.

## Files audited (re-lectura confirmatoria)

- `apps/portal/middleware.ts`, `lib/{cookie-config, cookie-names, insured-session, jwt, origin-allowlist}.ts`
- `apps/portal/app/api/auth/{portal-otp-request,portal-otp-verify,portal-logout}/route.ts`
- `apps/portal/app/api/proxy/[...path]/route.ts`
- `apps/portal/app/(auth)/{login,otp}/page.tsx`
- `apps/portal/app/(app)/{layout,page,coverages,certificate,claim/new,help}/page.tsx`
- `apps/portal/components/layout/{header,bottom-nav,chat-fab,theme-toggle}.tsx`
- `apps/portal/components/auth/login-form.tsx`
- `apps/portal/{next.config.mjs,vitest.config.ts,lighthouserc.js,package.json}`
- `apps/admin/{next.config.mjs,lib/cookie-config.ts,lib/origin-allowlist.ts,app/api/proxy/[...path]/route.ts}` (paridad)
- `packages/auth/src/{config,session,index}.ts`, `packages/api-client/src/hooks/certificates.ts`
- `segurasist-api/scripts/cognito-local-bootstrap.sh` (atributos Cognito)
- `segurasist-api/src/modules/claims/{claims.controller,claims.service}.ts` (audit write)

## Confirmaciones (de v1)

| ID v1 | Estado v2 | Nota |
|---|---|---|
| A8-01 Critical (proxy import wrong) | **Confirmado, no expandido** | Es un bug aislado al proxy del portal. El resto de consumers del portal usan `PORTAL_SESSION_COOKIE` correctamente. Fix sigue siendo 1 LOC. |
| A8-02 High (proxy sin checkOrigin) | **Confirmado + cross-cutting** | El proxy del **admin** tampoco invoca `checkOrigin()` (apps/admin/app/api/proxy/[...path]/route.ts no tiene la guarda). Mismo gap en ambas apps; consolidación obvia. |
| A8-03 High (CSP frame-src) | **Confirmado + cross-cutting con admin** | admin tiene la misma gap (A8-03b nuevo abajo). |
| A8-04..A8-17 | Sin cambios | Re-leídos; pendientes Sprint 4. |

## Issues nuevos (vuelta 2)

| ID | File:line | Severity | Category | Description | Recommendation |
|---|---|---|---|---|---|
| A8-18 | `apps/portal/lighthouserc.js:6` | Medium | DX / CI | URL hardcoded `http://localhost:3001/` (admin port) en config del portal. `pnpm --filter @segurasist/portal lighthouse` o falla (3001 no responde) o mide la app admin si admin está corriendo en paralelo — los thresholds de Performance/A11y reportados son del producto equivocado. Consistente con A10 ("Lighthouse no integrado en CI"). | Cambiar a `http://localhost:3002/` y validar contra `package.json:start` (3002). |
| A8-03b | `apps/admin/next.config.mjs:36-47` | High | Security (cross-cutting) | Mismo gap que A8-03 portal: CSP no declara `frame-src`. Admin no renderiza iframes hoy, pero el `cert detail` futuro y cualquier preview de PDF caerán en `default-src 'self'` y serán bloqueados. Consolidar el fix con el del portal. | Añadir `"frame-src 'self' https://*.amazonaws.com"` en ambos `next.config.mjs` o, mejor, mover el array CSP a `packages/security/` y exportar un builder único. |
| A8-19 | `apps/portal/app/api/auth/portal-logout/route.ts:59-70` | Medium | Pattern drift | El logout llama `res.cookies.set(name,'', {httpOnly,sameSite:'strict',path:'/',maxAge:0})` directamente, sin pasar por `buildSessionCookie()`. Faltan `secure: isSecureContext()` y la disciplina de tener un único helper para todo cookie de sesión (M6+L3). En prod no es vulnerable (maxAge:0 expira igual) pero rompe la regla "todo session cookie pasa por el helper". | Crear `clearSessionCookie(name)` en `lib/cookie-config.ts` que retorne el payload con `value:'', maxAge:0, secure: isSecureContext()` y reusarlo aquí + en cualquier futuro logout/refresh. |
| A8-20 | `apps/portal/app/api/auth/{portal-otp-request,portal-otp-verify,portal-logout}/route.ts` y `app/api/proxy/[...path]/route.ts` | Medium | DX / DevOps | `API_BASE` defaults inconsistentes: las 3 rutas de auth → `http://localhost:3000`, el proxy → `https://api.segurasist.app`. Si `API_BASE_URL` no se setea en una build (ej. preview), el proxy va a prod y los 3 auth handlers a localhost — login funciona, todo lo demás explota. **Mismo gap que A7-04** en admin (proxy → prod, otros → localhost). | Centralizar `getApiBase()` con un único default (preferentemente `localhost:3000` en dev, validar `process.env.API_BASE_URL` requerida en `production`). Cruza con A9 env validation. |
| A8-21 | `apps/portal/components/auth/login-form.tsx:35,213-221` | Low | Validation drift | Schema acepta `channel: z.enum(['email','sms'])` pero el `<SelectItem value="sms" disabled>` lo marca disabled visualmente. Un cliente que envíe `channel:'sms'` por curl pasa la validación de Zod del FE (no la del BE), y la propia API podría aceptar `sms` al ruteo. UX inconsistente: el contrato dice "email or sms" pero el feature flag es solo email Sprint 3. | Quitar `'sms'` del enum hasta que el BE soporte SMS, o documentar el flag. |
| A8-22 | `apps/portal/lib/origin-allowlist.ts:32` y `apps/admin/lib/origin-allowlist.ts:32` | Low | Cross-cutting (consolidación) | Las 2 funciones `getAllowedOrigins()` son byte-idénticas excepto por (a) `localhost:3001` vs `localhost:3002` y (b) `NEXT_PUBLIC_ADMIN_ORIGIN` vs `NEXT_PUBLIC_PORTAL_ORIGIN`. Ya está reportado por A7-58; aquí confirmamos que el portal no tiene drift adicional. | Consolidar en `packages/security/origin-allowlist.ts` con factory: `buildOriginAllowlist({devPort, envVarName})`. |
| A8-23 | `apps/portal/lib/cookie-config.ts` y `apps/admin/lib/cookie-config.ts` | Low | Cross-cutting (consolidación) | Las 2 funciones `isSecureContext()` + `buildSessionCookie()` son byte-idénticas (sólo cambia el header docstring). Ya está reportado por A7-58; aquí confirmamos cero drift. | Consolidar en `packages/security/cookie-config.ts` con cero parámetros (es un security primitive sin per-app config). |
| A8-24 | `segurasist-api/scripts/cognito-local-bootstrap.sh:151-155` | Medium | Cross-cutting (DX/UX) | El script bootstrap NO setea `given_name` en los usuarios de cognito-local. JWT emitido por el mock contiene email + custom:role + custom:tenant_id pero NO `given_name`/`name`. `lib/jwt.ts:readFirstNameFromToken` cae al fallback `email.split('@')[0]` → "insured.demo". Atributo correcto: **`given_name`** (standard OIDC, no `custom:`). | Añadir 5ta línea: `attrs_create+=("Name=given_name,Value=Demo")` (y el equivalente en `attrs_update`). Cruza con A8-16 v1 + A1 (mock cognito). |
| A8-25 | (negativo) `apps/portal/app/api/webhooks/*` | — | Confirmación | Inexistente. A4-04 (POST /v1/webhooks/ses sin throttle) NO tiene contraparte en el portal — bien. Documentar en `lib/origin-allowlist.ts:24` (la exención de webhooks-prefix está pre-codificada para el futuro). | N/A — solo confirma que no hay regresión. |
| A8-26 | (negativo) `packages/api-client/src/hooks/certificates.ts:21-28` | — | Confirmación | `CertificateMine` no expone `hash`. A4-01 (provisional hash persistido en BD) **no sale a UX del asegurado**. El bug sigue siendo un Critical de A4 (contrato del evento + verificación) pero el portal no lo amplifica. | N/A — confirma scope del bug A4-01. |
| A8-27 | (positivo) `segurasist-api/src/modules/claims/claims.service.ts:114-126` | — | Confirmación | POST /v1/claims (mutación que origina el portal `claim/new`) **sí pasa por `auditWriter.record`** con `action='create', resourceType='claims', subAction='reported'`. A6 interceptor + service-side audit alineados. | N/A — confirma que el portal no introduce gap de auditoría en mutaciones. |

## Patrones cross-cutting (apend al feed compartido)

```
[A8] 2026-04-25 21:00 Medium apps/portal/lighthouserc.js:6 — URL del LHCI hardcoded a http://localhost:3001/ (admin port) en lugar de :3002 (portal); pnpm lighthouse o falla o mide app equivocada // A10 (Lighthouse no integrado en CI lo enmascara), A9 (CI gate inválido si se activa).
[A8] 2026-04-25 21:00 High apps/admin/next.config.mjs:36-47 — mismo gap CSP frame-src que portal; defense-in-depth cross-cutting; el día que admin renderice iframe de cert preview, regresará el mismo bug // A4 (certificate UX), A8 (paridad portal).
[A8] 2026-04-25 21:00 Medium apps/portal/app/api/{auth/*,proxy/[...path]}/route.ts — drift de defaults API_BASE (auth→localhost, proxy→prod); idéntico patrón a A7-04 admin; sin env validation, builds preview rompen silente // A7 (mismo gap admin), A9 (env validation).
[A8] 2026-04-25 21:00 Medium segurasist-api/scripts/cognito-local-bootstrap.sh:151-155 — bootstrap NO emite given_name; portal cae a fallback email-local-part "insured.demo" en greeting; atributo correcto: `given_name` (OIDC estándar, no custom:) // A1 (mock cognito-local), A8-16 v1 (greeting fallback).
[A8] 2026-04-25 21:00 Medium apps/portal/app/api/auth/portal-logout/route.ts:59-70 — logout NO pasa por buildSessionCookie() para expirar; drift del patrón M6+L3 (no se setea Secure en clear) // A1 (auth hardening), A7 (paridad admin).
```

## Correlaciones con otras áreas (v2)

- **A1 (auth/RBAC)**:
  - `given_name` confirmado como atributo OIDC estándar requerido en cognito-local-bootstrap (A8-24).
  - El portal no tiene drift adicional sobre `custom:role` / `custom:insured_id` — todos los consumers (middleware + insured-session + jwt) leen las claims correctamente.
  - El backend `claims.service.ts:77` valida defensivamente `user.role !== 'insured'` aún cuando el RolesGuard ya filtró — defense-in-depth bien.
- **A4 (certificates/email)**:
  - A4-01 hash provisional **NO sale a UX**: `CertificateMine` no expone `hash`. Confirma que el alcance del bug es backend-only.
  - A8-03 frame-src faltante es el **único** vector que rompe el preview del certificado en prod desde el lado portal.
  - El cert preview iframe `sandbox="allow-same-origin"` es correcto (sin `allow-scripts`), defense-in-depth para el contenido S3.
- **A5 (insureds/reports)**:
  - El proxy del portal es la única ruta a `/v1/insureds/me`, `/v1/coverages/mine`, `/v1/claims`, `/v1/certificates/mine`. **Mientras el bug A8-01 esté presente, estos 4 endpoints están 100% rotos para el portal**.
- **A6 (audit/throttler)**:
  - POST /v1/claims sí registra audit (A8-27) — el portal no rompe la cadena de mutación auditada.
  - La mutación pasa por `@Throttle({ttl:3_600_000,limit:3})` por user-IP (controller line 33), no por @TenantThrottle — coherente con que el insured logueado no escoge tenant.
- **A7 (admin)**:
  - Confirmado byte-idénticos cookie-config + origin-allowlist; A8-22/A8-23 proponen consolidación.
  - A8-03b confirma que admin tiene la misma gap CSP.
  - A8-20 confirma misma drift de `API_BASE` defaults entre proxy y auth routes en ambas apps.
  - El proxy admin tampoco hace `checkOrigin()` — es un patrón cross-cutting (no exclusivo del portal A8-02).
- **A10 (tests/DX)**:
  - Confirmo gaps reportados: NO existe `app/api/proxy/[...path]/route.test.ts` (ni en admin ni en portal). El bug A8-01 habría sido detectado por un test que assert `Authorization: Bearer <portal-token>` se forwardea.
  - NO existe test de `claim/new` (`claim-form.test.tsx` removido por hoisting `vi.mock`, A10-75 confirma para admin export-button — mismo patrón).
  - NO existe `theme-toggle.test.tsx` ni `chat-fab.test.tsx` ni `insured-session.test.ts`.
  - `vitest.config.ts` sin `thresholds` (A10-77).
  - Lighthouse no integrado a CI (A10) + URL incorrecta en config (A8-18) → coverage real de Performance/A11y inexistente.

## Tests ausentes (priorizado para Sprint 4)

1. **`test/unit/app/api/proxy.test.ts`** — assert que `Authorization: Bearer <PORTAL_SESSION_COOKIE>` se forwardea (test que detecta A8-01 en CI). Stub `fetch` global, simular request con cookie `sa_session_portal=fake.jwt.payload`, verificar el header del upstream call.
2. **`test/unit/app/api/portal-logout.test.ts`** — assert clear-cookie correcto + bypass del fetch upstream (timeout/AbortController según A8-08 v1).
3. **`test/unit/components/claim-form.test.tsx`** — re-crear el archivo removido. Documentar el motivo del removal en `docs/audit/10-tests-dx.md` (cruce con A10-75).
4. **`test/unit/components/theme-toggle.test.tsx`** — read/apply theme + localStorage fallback.
5. **`test/unit/lib/insured-session.test.ts`** — server-only path con `cookies()` mockeado.
6. **CSP integration test** — assert `Content-Security-Policy` response header de `/_next/...` y `/certificate` incluya `frame-src` (gate de Sprint 4 antes de fix CSP).

## Recommendations Sprint 4 (consolidado v1+v2)

1. **Fix Critical A8-01** (1 LOC en `app/api/proxy/[...path]/route.ts:2,13`). Añadir test de proxy. **Sin esto el portal está 100% roto post-login.**
2. **Hardening cross-cutting**:
   - Añadir `frame-src 'self' https://*.amazonaws.com` a CSP de **ambos** `next.config.mjs` (portal + admin, A8-03 + A8-03b).
   - Añadir `checkOrigin()` al proxy de **ambas** apps (A8-02 + cross-cutting admin).
3. **Consolidación a `packages/security/`** (A8-22 + A8-23 + A7-58):
   - `cookie-config.ts` (zero-arg, idéntico) + helper `clearSessionCookie()` (A8-19).
   - `origin-allowlist.ts` (factory parametrizada).
   - `csp-builder.ts` (template con `frame-src` ya incluido + per-app overrides).
4. **Cognito-local-bootstrap** (A8-24 + A8-16 v1): añadir `Name=given_name,Value=Demo` a `attrs_create`/`attrs_update` para que el JWT emitido por el mock incluya el claim `given_name`. Coordinar con A1.
5. **Lighthouse fix + integración CI** (A8-18 + A10): cambiar URL a `:3002` y meter `pnpm lighthouse` al pipeline (puede ser warn-only Sprint 4).
6. **Tests críticos faltantes**: priorizar #1 y #2 de la lista anterior — son los que cubren el Critical y los gaps de hardening.
7. **Validación env**: `getApiBase()` consolidado + `env.schema` que requiera `API_BASE_URL` en production builds (A8-20 cruza con A9).
