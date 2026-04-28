# Audit Report v2 — Frontend admin (apps/admin) — 2da vuelta

> Re-revisión correlacionada de A7 con findings convergentes de A1 (auth), A4 (certificates/CSP), A6 (audit/throttler), A8 (portal), A9 (devops/IaC) y A10 (tests/DX). Lecturas READ-ONLY.

## Summary v2 (≤10 líneas)

La 1ra vuelta identificó issues importantes en el callback NextAuth (A7-01/02), duplicación admin↔portal (A7-03), mock tenant mobile (A7-04), dead code (A7-05/06), defaults env-var (A7-08). Esta 2da vuelta confirma todos y suma cinco patrones nuevos: (1) **el gap de cookies lax NO está limitado al callback** — `protectMiddleware` (`packages/auth/src/middleware.ts:64`) llama `setSessionCookies` en cada **silent refresh** en producción, así que toda sesión admin que pase un refresh queda lax sin importar el callback Cognito; (2) la **CSP admin** comparte el patrón problemático del portal (sin `frame-src`), pero hoy admin **no renderiza iframes** — riesgo latente si Sprint 4 agrega preview de cert; (3) **vitest coverage `include`** del admin **excluye precisamente** los archivos con findings High (callback NextAuth, proxy, mobile-drawer) — los thresholds 80/75/80/80 NO los protegen; (4) **`turbo test:unit dependsOn ^build`** infla CI específicamente para admin/portal por `transpilePackages` source-mapped; (5) `auth-server.ts` consume `body.email/role/tenant.id` PERO ignora `body.id` (cognitoSub) — no expuesto al cliente, OK pero queda como contrato implícito. **Findings nuevos: 9 (1 Critical, 3 High, 3 Medium, 2 Low).**

## a) Patrones convergentes — CSRF systemic auth wiring

### Mapa de handlers `/api/auth/*` admin

| Handler | Method(s) | Cookie helper | sameSite | CSRF posture |
|---|---|---|---|---|
| `app/api/auth/local-login/route.ts:166-179` | POST | `buildSessionCookie` (admin) | **strict** | OK — Origin check + handler re-check |
| `app/api/auth/me/route.ts:17-58` | GET | n/a (read-only) | n/a | OK (GET) |
| `app/api/auth/[...nextauth]/route.ts:68` (callback Cognito) | GET | `setSessionCookies` (legacy) | **lax** | **GAP H-02** |
| `app/api/auth/[...nextauth]/route.ts:77-81` (logout) | GET (+ `POST = GET`) | `clearSessionCookies` | n/a | **CSRF-able vía `<img src>`** |
| `app/api/proxy/[...path]/route.ts` | GET/POST/PUT/PATCH/DELETE | n/a (forwards) | n/a | OK (cookie sa_session SameSite=Strict ya seteado) |

### `packages/auth/src/session.ts` aún consumido por admin runtime

**SÍ — vía `protectMiddleware` (path crítico, no sólo callback)**:
- `apps/admin/middleware.ts:92` invoca `protectMiddleware` (en producción).
- `packages/auth/src/middleware.ts:64` ejecuta `setSessionCookies(res, tokens)` cuando el access token expiró y el refresh token aún es válido — **silent refresh**.
- `packages/auth/src/session.ts:21-37` setea `sa_session` y `sa_refresh` con `sameSite:'lax'`, `secure:true` HARDCODEADO (sin allowlist), sin `maxAge` allowlist.
- **Consecuencia**: cada admin user en prod, tras los primeros 15 min (SESSION_MAX_AGE), recibe la próxima request con cookies lax — bypaseando M6+L3 silenciosamente y sin pasar por el callback Cognito.

### Endpoint admin `/api/auth/me` (server-side legacy?)

- `app/api/auth/me/route.ts` SÓLO lee `sa_session` (Strict, ya setteada por local-login) y forwardea como Bearer + `Cookie: session=...`. NO setea cookies. **No usa legacy**.
- `lib/auth-server.ts:fetchMe()` consume `body.email/role/tenant.id` y aún tolera `body.user.*`/`body.data.*` (legacy fallbacks). **No consume `body.id`**, así que el cognitoSub-as-id (A1-04) no toca admin hoy.

## b) DRY admin↔portal — mapa completo

| Archivo admin | Archivo portal | Estado | Recomendación |
|---|---|---|---|
| `lib/origin-allowlist.ts` | `lib/origin-allowlist.ts` | **Byte-idéntico** (`diff` confirma) | Promover a `packages/security/origin.ts` |
| `lib/cookie-config.ts` | `lib/cookie-config.ts` | Funcionalmente idéntico (sólo cambian comentarios) | Promover a `packages/security/cookie.ts` (parametrizar `SameSite` para futuros casos) |
| `lib/jwt.ts:decodeJwtPayload` | `lib/jwt.ts:decodeJwtPayload` | Lógica idéntica; portal añade getters extra (`readGreetingFromToken`) | Mover decoder a `packages/auth/src/jwt-decode.ts`; mantener readers app-locales |
| `app/api/proxy/[...path]/route.ts` | `app/api/proxy/[...path]/route.ts` | Estructura ~85% idéntica; portal omite `x-tenant-override` y, **bug A8-01**, lee la cookie equivocada | Promover a `packages/security/proxy.ts` con factory `createProxyHandler({ sessionCookie, headers, originCheck? })` — fix A8-01 sale gratis |
| `lib/cookie-names.ts` (portal) | n/a (admin reusa SESSION_COOKIE de @segurasist/auth) | Contrato divergente; admin acopla a `@segurasist/auth`, portal abstrae | Migrar admin a un `cookie-names.ts` propio o mover ambas constantes a `packages/security/cookie-names.ts` |

**Candidato propuesto: `packages/security/`** con submodulos `cookie.ts` (M6+L3 helpers), `origin.ts` (M6 CSRF), `proxy.ts` (factory), `cookie-names.ts`. Reduce 4-5 archivos duplicados a 1 fuente de verdad. Coordinar con A8 (que ya pidió lo mismo) y A1 (puede absorber `packages/auth/src/session.ts` v2 con cookie-config-strict).

## c) Correlaciones nuevas

### A4-03 CSP `frame-src` faltante — ¿afecta admin?

- **Hoy NO**: `apps/admin/next.config.mjs:36-47` carece de `frame-src` igual que portal, pero **admin no renderiza iframes** (`grep -rn iframe apps/admin/` → 0 matches). El tab "Certificados" (`certificados.tsx`) usa `Download` (presigned URL → nueva pestaña/descarga) y `QR view` (modal con datos del payload, no iframe). El botón "Reemitir" es placeholder Sprint 4.
- **Riesgo latente**: Sprint 4 puede agregar preview de PDF cert en modal usando iframe — caería en el mismo bloqueo que reportó A8 para portal. **Recomendación preventiva**: agregar `frame-src 'self' https://*.amazonaws.com` a la CSP de admin **antes** de Sprint 4 para que no bloquee el preview cuando llegue.
- También: admin ya tiene `frame-ancestors 'none'` + `X-Frame-Options DENY` (estrictos), eso es para **ser frameado** y no entra en conflicto.

### A1-04 `/v1/auth/me` expone `cognitoSub` como `id` — ¿auth-server.ts lo asume FK?

- **NO en admin**. `auth-server.ts:9-18` define `MeResponse` con `id?: string` pero `Me` (línea 20-24) NO incluye `id`. El layout (`app/(app)/layout.tsx:37`) y todas las páginas que consumen `fetchMe()` usan sólo `email`, `role`, `tenantId`. **El cognitoSub-as-id no toca admin**.
- **Sí toca el JSON forwarding**: `app/api/auth/me/route.ts:53-56` forwardea el body upstream verbatim. Si un componente cliente eventual consumiera `/api/auth/me` y leyera `body.id`, asumiría users.id por convención. Riesgo bajo pero real.
- **Recomendación**: documentar el contrato en un comentario JSDoc en `route.ts` ("body.id = cognitoSub, NO users.id (FK BD)") como guard rail futuro.

### A10 `turbo test:unit dependsOn ^build` infla CI — ¿afecta gates Sprint 4?

- **Sí, ataca el path crítico**: admin (y portal) consumen `@segurasist/{ui,api-client,auth,i18n}` vía `transpilePackages` (next.config.mjs:18-23). Con `^build` activo, cada `pnpm test:unit` en CI fuerza la compilación de los 4 packages aunque los tests sólo necesitan source TS (Vitest los compila on-the-fly).
- Cache miss alto: cualquier cambio en `packages/ui/**` invalida el build cache del 100% de tests downstream.
- **Recomendación cross-cutting** (ya en feed por A10): cambiar `test:unit` a `dependsOn: []` o `^typecheck` (mucho más rápido). Los tests no dependen de los `dist/` (Vitest resuelve a TS source).

## d) Re-lectura de código — confirmaciones

### `app/(app)/insureds/[id]/auditoria.tsx` — audit cross-cutting

- **OK**: avatar + actor + action humanizado + timestamp + IP enmascarada (`maskIp` IPv4→`x.x.x.*`, IPv6→`x:x::*`).
- **OK**: timeline expandible con `payloadDiff` JSON formateado.
- **Cross-cutting con A6**: el export CSV en línea 104 hace `<a href="/api/proxy/v1/audit/log?...&format=csv">` y A6-46 reportó `verify-chain` sin `@Throttle`. **Verificar si `/v1/audit/log` GET tiene `@Throttle`** — si no, mismo riesgo DoS si un browser malicioso abre 1000 tabs con ese link. (No es bug admin, pero el FE depende del backend tener rate limit en ese path).
- **Cross-cutting con A1-04**: el `actorEmail` y `ip` vienen del backend `audit.records` que sí guarda users.id real (no cognitoSub). OK.

### Vista 360° — 5 tabs y su exposición a iframe

| Tab | Componente | Iframe? | Riesgo CSP |
|---|---|---|---|
| Datos | `datos.tsx` | No | n/a |
| Coberturas | `coberturas.tsx` | No | n/a |
| Eventos | `eventos.tsx` | No | n/a |
| Certificados | `certificados.tsx` | No (Download → presigned URL nueva pestaña; QR → modal con texto) | n/a hoy; **frame-src faltará si Sprint 4 agrega preview inline** |
| Auditoría | `auditoria.tsx` | No | n/a |

### `middleware.ts` admin vs `middleware.ts` portal

- Admin `middleware.ts:84-107`: Origin → dev/prod gate → role-based redirect a portal.
- Portal: NO leído en esta vuelta (out of scope de B7), pero sí confirmé que la **cookie del proxy portal está mal cableada** (A8-01: lee `sa_session` en lugar de `sa_session_portal`).

### `packages/auth/` consumido por admin

- `middleware.ts:3` import `protectMiddleware` (prod path) → llama `setSessionCookies` en silent refresh.
- `[...nextauth]/route.ts:10` import `setSessionCookies/clearSessionCookies` directamente.
- `local-login/route.ts:2`, `me/route.ts:2`, `proxy/[...path]/route.ts:2` import `SESSION_COOKIE` (constante, OK).

## e) Tests — cobertura de los gaps

| Gap | Test existe? | Notas |
|---|---|---|
| A7-01 (callback Cognito lax) | **NO** | `[...nextauth]/route.ts` excluido del coverage `include` (`vitest.config.ts:39-50`). 0 tests del callback OAuth. |
| A7-02 (CSRF logout GET) | **NO** | Mismo archivo excluido. No hay test del Origin-check para logout porque logout no tiene Origin-check. |
| A7-03 (DRY admin↔portal) | n/a | No es un gap testeable; es estructural. |
| A7-04 (mobile-drawer mock) | **NO** | `mobile-drawer.tsx` excluido del coverage `include`. 0 tests del drawer mobile. |
| `local-login` cookie wiring | **SÍ** | `local-login.test.ts:277-327` cubre SameSite=Strict + Secure flag + dev fallback (vía `vi.stubEnv`). Excelente cobertura. |
| Tenant-switcher mobile | **NO** | `tenant-switcher.test.tsx` cubre **sólo desktop dropdown** (admin_segurasist y read-only); no toca el `<Select>` hard-coded del mobile-drawer. |
| `export-button` (insureds) | **NO** | A10-75 ya lo reportó; aplica a admin (`components/insureds/export-button.tsx`). 0 tests. |
| Proxy passthrough (`x-tenant-override`) | **NO** | `proxy/[...path]/route.ts` excluido del coverage. 0 tests del forwarding del header tenant override (S3-08). |

**Patrón sistémico**: `vitest.config.ts:39-50` define un `coverage.include` selectivo que **excluye exactamente los archivos donde están los findings High** (callback NextAuth, proxy, mobile-drawer). Los thresholds 80/75/80/80 quedan satisfechos sin proteger las superficies de mayor riesgo.

## Findings nuevos v2

| ID | File:line | Severity | Category | Description | Recommendation |
|---|---|---|---|---|---|
| **A7v2-01** | `packages/auth/src/middleware.ts:64` (consumido por `apps/admin/middleware.ts:92`) | **Critical** | Security | `protectMiddleware` ejecuta `setSessionCookies` en cada silent refresh (path producción). Toda sesión admin >15 min termina con cookies `sameSite:'lax'`, sin pasar por el callback NextAuth. **El gap H-02 NO está limitado al callback Cognito** — el path de uso normal lo dispara también. | Migrar `setSessionCookies/clearSessionCookies` en `packages/auth/src/session.ts` a usar `buildSessionCookie` (admin) o equivalente promovido a `packages/security/`. Test regression: middleware integration test en jsdom + `MSW` simulando expiry. |
| **A7v2-02** | `apps/admin/vitest.config.ts:39-50` | **High** | Test-coverage / Process | `coverage.include` enumera archivos manualmente y **excluye** los archivos con findings High (callback NextAuth, proxy, mobile-drawer). Los thresholds 80/75/80/80 son cosméticos para esas superficies. | Ampliar `include` a `app/api/**` + `app/_components/**` (al menos), o mover a `coverage.all: true` con `coverage.exclude` específico. Ya hay precedente: portal usa `vitest.config.ts:29-37` sin thresholds (gap A10-77). |
| **A7v2-03** | `apps/admin/next.config.mjs:36-47` | **High** | Security (preventiva) | CSP admin sin `frame-src` (igual que portal A8-03). Hoy admin NO usa iframes, pero Sprint 4 contempla preview de cert (S3-06 menciona "Reemitir certificado abre modal de motivos" — probable iframe para PDF). Si se agrega sin actualizar CSP, falla en prod silenciosamente. | Anticipar y agregar `frame-src 'self' https://*.amazonaws.com` ahora junto con la promoción a `packages/security/` (CSP también puede vivir compartida). |
| **A7v2-04** | `apps/admin/app/api/auth/[...nextauth]/route.ts:77-86` | **High** | Security | Confirma A7-02: además de `POST = GET` aliased, el handler **no expone `OPTIONS`/`HEAD`** y la única forma de logout es GET. Cualquier `<a href="/api/auth/logout">` funciona como CSRF logout. **Adicional**: los tests del local-login ya validan Origin check; el callback/logout NO tienen ningún test (A7v2-02). | Reemplazar el catch-all `[...nextauth]/route.ts` por handlers individuales: `auth/login/route.ts` (GET-redirect), `auth/callback/route.ts` (GET), `auth/logout/route.ts` (POST + Origin check). Agregar tests por handler. |
| **A7v2-05** | `packages/auth/src/middleware.ts:74-76` | **Medium** | Security | `clearSessionCookies` (línea 75) NO setea `sameSite:'strict'` ni `secure:isSecureContext()` en el response cookie de borrado. `cookies.delete()` no preserva esos flags, y un MITM en una redirección "logout → /login" podría reescribir la cookie con un valor antes de que llegue el delete. Edge case real para insureds en redes públicas. | Cambiar `clearSessionCookies` a `res.cookies.set(NAME, '', { ...buildSessionCookie payload, maxAge: 0 })` cuando se promueva al package compartido. |
| **A7v2-06** | `apps/admin/app/api/auth/me/route.ts:35` + `apps/admin/lib/auth-server.ts:51` | **Medium** | Contract drift | A1-04 reporta que `/v1/auth/me` ahora devuelve `id = cognitoSub` (NO users.id). El proxy admin forwardea verbatim; `MeResponse.id?: string` queda definido pero no consumido. Si alguien (Sprint 4) lee `body.id` asumiendo FK, romperá. | Comentario JSDoc explícito en `MeResponse.id` ("cognitoSub, NOT users.id"). Coordinar con A1: si backend cambia a devolver `userId` separado, eliminar el campo `id` del proxy o renombrarlo. |
| **A7v2-07** | `apps/admin/turbo.json` (vía monorepo turbo.json:34-37) | **Medium** | DX / CI | Confirma A10-76 con foco admin: `^build` antes de `test:unit` significa compilar `@segurasist/ui|api-client|auth|i18n` (4 packages source-mapped) cada vez. Vitest no necesita `dist/`. CI time inflado ~2-3 min por job admin. | Cambiar a `dependsOn: ["^typecheck"]` o vacío. Tests pasan igual; trade-off es que un `tsc --noEmit` no atrapa todos los errores de tipos cross-package, pero `typecheck` global ya cubre eso. |
| **A7v2-08** | `apps/admin/lib/auth-server.ts:9-18,51-52` | **Low** | Contract / cleanup | A7-12 (1ra vuelta) ya pidió quitar `body.user.*`/`body.data.*` fallbacks. **Confirmado**: `auth-server.test.ts:117-149` tiene tests específicos para esos fallbacks legacy. Si A1 confirma contrato estable, eliminar tests + fallbacks libera ~30 LOC y evita confundir el contrato. | Coordinar con A1 (auth) un cleanup conjunto: eliminar fallbacks + actualizar tests. |
| **A7v2-09** | `apps/admin/components/insureds/export-button.tsx` (sin test) + `apps/admin/.eslintrc.json` (next-only) coexiste con `eslint.config.mjs` flat | **Low** | Test-coverage / DX | A10-75 + A10-81 ya lo reportaron: export-button sin test, dual ESLint config. Aplica directo a admin: `next lint` (legacy `.eslintrc.json:extends "next/core-web-vitals"`) y `pnpm lint` (flat `eslint.config.mjs`) pueden divergir. | Eliminar `apps/admin/.eslintrc.json` y dejar la config flat heredada del root. Crear `export-button.test.tsx` mínimo (render + click → verifica POST + cookie wiring). |

## Cross-cutting (apend al feed)

```
[A7v2] 2026-04-25 20:30 Critical packages/auth/src/middleware.ts:64 (consumido por apps/admin/middleware.ts:92) — protectMiddleware ejecuta setSessionCookies en cada silent refresh; cookies admin terminan sameSite=lax sin pasar por callback Cognito. // A1: H-02 NO se cierra fixeando sólo callback NextAuth — fix debe vivir en packages/auth/src/session.ts. A8: portal usa setSessionCookies/clearSessionCookies SOLAMENTE vía protectMiddleware? verificar; misma exposure si sí.
[A7v2] 2026-04-25 20:30 High apps/admin/vitest.config.ts:39-50 — coverage.include excluye exactamente los archivos con findings High (callback NextAuth, proxy, mobile-drawer); thresholds 80/75/80/80 cosméticos para superficies de mayor riesgo. // A10: confirmar pattern en portal (already gap A10-77, sin thresholds). Considerar mover regla "include all + exclude specific" a un eslint-plugin custom o test global.
[A7v2] 2026-04-25 20:30 High apps/admin/next.config.mjs:36-47 — CSP sin frame-src, idéntico al gap A8-03 portal. Hoy admin NO usa iframe, pero Sprint 4 (modal de cert reissue) lo introducirá. Anticipar fix. // A4: si la "vista preview de PDF" llega a admin, validar CSP en mismo PR. A8: promover CSP a packages/security/ cuando se haga.
```

## Recommendations Sprint 4 (priorizadas)

1. **(Critical)** Cerrar A7v2-01 antes que cualquier otro fix de auth. La fuga lax-via-refresh hace todos los hardenings M6+L3 cosméticos en producción tras 15 min de uso.
2. **(High)** A7v2-02 — ampliar `coverage.include` o pasar a `all: true`. Los gates de coverage no protegen los caminos críticos hoy.
3. **(High)** A7v2-04 — separar `[...nextauth]/route.ts` en handlers individuales con tests dedicados; aplicar Origin-check al logout.
4. **(High prevent)** A7v2-03 — agregar `frame-src 'self' https://*.amazonaws.com` antes de Sprint 4.
5. **(Medium)** A7v2-05/06/07 + A7-03 (1ra vuelta) — promover `packages/security/` con `cookie.ts`, `origin.ts`, `proxy.ts`, `cookie-names.ts`. Cambia el ROI de cualquier fix subsiguiente.
6. **(Low)** A7v2-08/09 + cleanup A7-05/06/07/13 (1ra vuelta).

## Score actualizado

**1ra vuelta** estimaba B+ con 17 issues. **2da vuelta** suma 9 issues nuevos (1 Critical, 3 High). Crítico sin parche en producción: A7v2-01 degrada el hardening M6 silenciosamente, lo que **degrada el rating a B-** hasta que se cierre. El refactor a `packages/security/` lo eleva a A- de un golpe.
