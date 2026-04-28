# Audit Report — Frontend portal asegurado (A8)

## Summary

El portal asegurado (`apps/portal`) entrega un shell mobile-first premium correcto en estructura, estética y patrones de auth (login + OTP + cookies HttpOnly + middleware insured-only). Sin embargo, contiene **un bug crítico de routing de cookies en el proxy** que rompe TODAS las llamadas autenticadas al backend desde el portal: el proxy importa `SESSION_COOKIE` (admin: `sa_session`) en lugar de `PORTAL_SESSION_COOKIE` (`sa_session_portal`). El header `Authorization: Bearer` nunca se setea para insureds y los hooks (`useInsuredSelf`, `useCoveragesSelf`, `useCertificateMine`, `useCreateClaimSelf`) reciben 401. Además el proxy NO valida Origin allowlist (regresión vs los otros 3 route handlers) y la CSP carece de `frame-src` por lo que la preview iframe del certificado (S3 pre-signed) cae a `default-src 'self'` y nunca renderiza. Los 56 tests verdes (target 64) cubren bien CURP/OTP/StatusHero/coverages, pero faltan tests de proxy, claim-form, theme-toggle e insured-session.

## Files audited

24 archivos productivos + 10 archivos de test:

- `middleware.ts`
- `lib/{cookie-config, cookie-names, origin-allowlist, jwt, insured-session}.ts`
- `lib/hooks/use-formatted-date.ts`
- `app/layout.tsx`, `app/providers.tsx`
- `app/(auth)/{login,otp}/page.tsx`
- `app/(app)/{layout,page}.tsx`, `app/(app)/{coverages,certificate,help,claim/new}/page.tsx`
- `app/api/auth/{portal-otp-request,portal-otp-verify,portal-logout}/route.ts`
- `app/api/proxy/[...path]/route.ts`
- `components/auth/{login-form,otp-form,otp-input}.tsx`
- `components/layout/{header,bottom-nav,chat-fab,theme-toggle}.tsx`
- `next.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`, `package.json`
- `test/unit/components/{login-form,otp-input,header,home-page,coverages-page,certificate-page,bottom-nav}.test.tsx`
- `test/unit/lib/{cookie-config,origin-allowlist,use-formatted-date}.test.ts`

## Strengths

1. **Cookie hardening replicado del admin**: `lib/cookie-config.ts` usa allowlist explícita (`production` + `staging`), `httpOnly`, `Secure` condicional, `SameSite=Strict`. Tests cubren typos como `prod` y whitespace padding. Cookie names centralizados en `lib/cookie-names.ts` (fix Sprint 3).
2. **Origin allowlist sólido en route handlers de auth**: `portal-otp-request`, `portal-otp-verify`, `portal-logout` invocan `checkOrigin` defense-in-depth aparte del check del middleware, con webhook exemption pre-codificada para futuro.
3. **Tokens nunca expuestos al cliente**: `portal-otp-verify` retorna `{ ok: true }` y monta el IdToken/RefreshToken como cookies HttpOnly server-side; el cliente solo conoce el resultado booleano.
4. **OTP UX premium**: `OtpInput` cubre paste 6-cells, auto-submit en el sexto dígito (con guard `lastCompletedRef` contra StrictMode double-fire), backspace inverso, ArrowLeft/Right, `autoComplete="one-time-code"`, ARIA por celda. `OtpForm` añade countdown TTL, cooldown de reenvío y attempts remaining.
5. **StatusHero declarativo**: `STATUS_VARIANTS` (vigente / proxima_a_vencer / vencida) en tabla `as const` — no `if/else` ramificados; cambiar copy/color es trivial.
6. **A11y mobile**: Todos los CTAs y tabs tienen `min-h-[44px]`/`h-14`, `safe-area-inset-{top,bottom}` en sticky header + bottom nav, skip-link en root layout, `aria-live="polite"` en counters/status.
7. **TanStack Query**: `staleTime: 60_000` global + por hook, `retry: 1`, error/empty/skeleton states implementados en TODAS las páginas (no pantalla en blanco).
8. **CURP UX**: regex RENAPO inline, uppercase forzado, success border verde + check icon, error tras `touch`, fallback help ("18 caracteres. La encuentras en tu acta de nacimiento o INE").

## Issues found

| ID | File:line | Severity | Category | Description | Recommendation |
|---|---|---|---|---|---|
| A8-01 | `app/api/proxy/[...path]/route.ts:2,13` | **Critical** | Security / Pattern | Proxy importa `SESSION_COOKIE` (`sa_session`, admin) de `@segurasist/auth` en vez de `PORTAL_SESSION_COOKIE` (`sa_session_portal`). Insured logueado vía portal tiene `sa_session_portal` pero proxy lee `sa_session` (vacío) → `Authorization: Bearer` jamás se envía → backend devuelve 401 a TODAS las llamadas (`useInsuredSelf`, `useCoveragesSelf`, `useCertificateMine`, `useCreateClaimSelf`). Funcionalmente rompe el flujo completo post-login. | Importar `PORTAL_SESSION_COOKIE` de `lib/cookie-names.ts` y reemplazar la ref a `SESSION_COOKIE`. |
| A8-02 | `app/api/proxy/[...path]/route.ts:12-44` | **High** | Security | Proxy NO invoca `checkOrigin()` — los otros 3 route handlers sí lo hacen (defense-in-depth). Una request malformada con `Origin` foreign sigue siendo bloqueada por middleware, pero si el matcher cambia o si un internal caller bypassa middleware, el proxy queda abierto a CSRF que reusa la cookie SameSite=Strict-bypass clásica. | Añadir `checkOrigin` al inicio de `handle()` (paridad con `portal-otp-*`). Mismo patrón que en admin. |
| A8-03 | `next.config.mjs:20-31` | **High** | Security / Performance | CSP no declara `frame-src`. Cae a `default-src 'self'`. La página `app/(app)/certificate/page.tsx` renderiza `<iframe sandbox="allow-same-origin" src={signedAmazonAwsUrl}>` que será **bloqueado** por CSP en prod. Botón "Descargar PDF" funciona (`window.open`), pero el preview UX visible queda en blanco. | Añadir `"frame-src 'self' https://*.amazonaws.com"` o aceptar UX sin preview (quitar el iframe). |
| A8-04 | `components/auth/otp-input.tsx:128-146` | Medium | Clarity / Bug | `handlePaste` sólo llena celdas a partir del `index` donde se pegó (`sourceIndex = i - index`). Si el usuario tiene foco en cell 3 y pega "123456", llena 3..5 con "123" y descarta "456" — comportamiento sorpresivo cuando el spec premium dice "1 paste llena 6 cells". El happy path (foco en cell 0) funciona; el caso edge no. | Detectar pasted.length === length y forzar `next = pasted.split('')` ignorando index, o limpiar el resto de celdas si pasted < length. |
| A8-05 | `app/api/proxy/[...path]/route.ts:15` | Medium | Security | Body GET copia raw `searchParams` y hace `url.searchParams.append(k, v)` — riesgo de re-serialización pierde codificación si vienen `+` espacios. No es bug actual pero es fricción Sprint 4 cuando se añadan filters. | Reescribir como `url.search = req.nextUrl.search` (preserva exact bytes) o documentar contrato. |
| A8-06 | `app/(app)/layout.tsx:29` + `app/(app)/page.tsx:33` | Medium | Maintainability | `padding-bottom` está duplicado: parent flex (`env(safe-area-inset-bottom)`) + main (`pb-24`) + bottom nav (`safe-area-inset-bottom`). Acumula >116px en iOS reales. Visualmente correcto en simuladores pero gasta viewport. | Centralizar en una sola capa (idealmente body o main, NO ambos). |
| A8-07 | `app/(auth)/otp/page.tsx:33` | Medium | Security | El `masked` viene del `searchParams` y se renderiza sin sanitizar dentro del subtitle (`Revisa tu correo (${masked})`). React escapa, no XSS, pero el atacante puede inyectar texto arbitrario en una URL de phishing copy-paste (`?masked=urgent_call_555`). | Validar contra una regex de email/phone masked antes de mostrar (`/^[a-z0-9*]+@[a-z*.]+$/i`) o aceptar el riesgo bajo (es UX, no seguridad). |
| A8-08 | `app/api/auth/portal-logout/route.ts:36-49` | Medium | Pattern | `await fetch` adentro de un `try/catch` con comentario "fire-and-forget" pero realmente bloquea hasta que upstream responda. En prod con backend down el logout demora hasta `fetch` timeout (~30s). | Añadir `AbortController` con timeout 2s o convertir a true fire-and-forget (no `await`). |
| A8-09 | `lib/origin-allowlist.ts:32` | Low | Security | `getAllowedOrigins()` hardcodea `http://localhost:3002` incluso en builds de prod. Si por error `NEXT_PUBLIC_PORTAL_ORIGIN` no se configura, el portal acepta `localhost:3002` desde un browser local apuntando a un backend prod (con red rara o `/etc/hosts`). | Encapsular el fallback `localhost` con `if (NODE_ENV !== 'production')`. |
| A8-10 | `app/(app)/page.tsx:51` | Low | Clarity | `firstName = data.fullName.split(' ')[0]` re-implementa la lógica que ya vive en `lib/jwt.ts:readFirstNameFromToken` y en `header.tsx`. Drift risk (admin/portal usan distintos heurísticos). | Centralizar en un util `splitFirstName(fullName)` y reusar. |
| A8-11 | `components/auth/otp-form.tsx:91-94` | Low | Clarity | Mensaje de error mezcla `Te quedan ${remaining} intento${remaining === 1 ? '' : 's'}` — pluralización inline. Ya hay `next-intl` en deps pero no se usa para microcopy. | Mover a i18n o aceptar microcopy hardcoded como decisión del equipo. |
| A8-12 | `test/unit/lib/origin-allowlist.test.ts` | Low | Test-coverage | 11 `it()` directos + 2 `it.each()` (5+5 = 10 dynamic) → ~21 casos efectivos. La planilla pedía 17 — cumple. **Pero falta** un test de "POST /api/proxy/* sin Origin con cookie válida → cómo responde". El proxy NO se testea hoy. | Añadir test E2E o stub MSW para route `[...path]`. |
| A8-13 | `app/api/proxy/[...path]/route.ts:24-26` | Low | Performance | Lee body con `req.arrayBuffer()` para todos los métodos no-GET — ok para JSON pero el portal NO sube binarios; es overhead innecesario. | Sustituir por `req.text()` (menos GC pressure) excepto si se planea multipart Sprint 4. |
| A8-14 | `vitest.config.ts:30-37` + `package.json` | Low | DX | Coverage incluida pero no hay umbral mínimo (`thresholds: { lines: 80 }`). Sprint 4 puede regresar % sin alarmar CI. | Definir thresholds en vitest config o coverage gate en CI. |
| A8-15 | `components/layout/chat-fab.tsx:14-19` | Low | Pattern | Placeholder Sprint 4 (toast informativo). No es bug, pero `aria-label="Abrir asistente virtual"` es engañoso porque NO abre nada. | Cambiar a `aria-label="Asistente virtual (próximamente)"` o `aria-disabled="true"`. |
| A8-16 | `app/(app)/page.tsx:51` + greeting fallback | Low | UX | Si el JWT solo trae `email=insured.demo@…`, el greeting muestra "Hola, insured.demo" (heurístico de `readFirstNameFromToken`). En el flujo de mock cognito-local SIEMPRE pasa esto. | Coordinar con A1 / cognito-local para añadir `given_name` al token (fix Sprint 4). |
| A8-17 | `app/(app)/certificate/page.tsx:51-54` | Low | Security | `window.open(data.url, '_blank', 'noopener,noreferrer')` pasa URL pre-firmada a una pestaña nueva. La URL queda en el history del browser (privacy concern: PII en URL queryparams si SES la indexa). | Documentar en readme; opcionalmente swap a `<a download>` server-side proxy. |

## Cross-cutting concerns (apend al feed compartido)

```
[A8] 2026-04-25 18:30 Critical apps/portal/app/api/proxy/[...path]/route.ts:2,13 — proxy importa SESSION_COOKIE (admin) en lugar de PORTAL_SESSION_COOKIE; insureds nunca obtienen Bearer en el upstream → 401 en TODAS las llamadas autenticadas del portal // A1 (RBAC: nada que ver con backend, es FE bug); A5 (useInsuredSelf falla); A4 (useCertificateMine falla); A10 (gap de test E2E proxy).
[A8] 2026-04-25 18:30 High apps/portal/app/api/proxy/[...path]/route.ts:12-44 — proxy del portal no invoca checkOrigin() (regresión vs portal-otp-*) // A6 hardening; defensa en profundidad si middleware falla.
[A8] 2026-04-25 18:30 High apps/portal/next.config.mjs:20-31 — CSP no declara frame-src; iframe certificate (S3 signed url) bloqueado en prod por default-src 'self' // A4 (UX preview certificate roto); A9 (revisar parity de CSP entre admin/portal).
[A8] 2026-04-25 18:30 Medium apps/portal/app/(app)/page.tsx:51 — fallback greeting "Hola, insured.demo" cuando JWT solo trae email; coordinar con cognito-local para emitir given_name // A1 (mock cognito) / A4 (email templates pueden necesitar el mismo claim).
[A8] 2026-04-25 18:30 Low apps/portal/components/layout/chat-fab.tsx:14 — placeholder Sprint 4 chatbot; función no implementada // Sprint 4 chatbot agente.
```

## Recommendations Sprint 4

1. **Fix Critical A8-01 inmediatamente** (1 LOC): cambiar import en `app/api/proxy/[...path]/route.ts` de `SESSION_COOKIE` a `PORTAL_SESSION_COOKIE`. Sin esto, el portal está roto end-to-end. Añadir test de proxy que assert `Authorization: Bearer <portal-token>` se forwardea.
2. **Hardening proxy + CSP** (A8-02 + A8-03): replicar `checkOrigin()` en `handle()` y añadir `frame-src 'self' https://*.amazonaws.com` a CSP. Crear test que assert el iframe carga sin violar CSP (Lighthouse CI ya está configurado, ampliar).
3. **Cobertura de tests faltante**: añadir tests para `app/api/proxy/[...path]`, `lib/insured-session.ts`, `components/layout/theme-toggle.tsx`, `app/(app)/claim/new/page.tsx` (claim-form). El target del checklist (64) está a 8 de los 56 actuales. Documentar en `docs/audit/10-tests-dx.md` el motivo del removal del claim-form test.
4. **OTP paste edge case** (A8-04): hacer que pegar 6 dígitos llene siempre las 6 celdas independientemente del foco. Es UX premium del checklist y es bug.
5. **Centralizar `splitFirstName`** y aceptar el contrato `given_name` (A8-10 + A8-16) en coordinación con A1/cognito-local. Resolverá el "Hola, insured.demo" awkward.
