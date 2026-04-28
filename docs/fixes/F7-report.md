# Fix Report — F7 B-COOKIES-DRY

## Iter 1 (resumen)

### Issues cerrados

| ID | SEV | File:line | Descripción del fix |
|---|---|---|---|
| **C-11** | Critical | `segurasist-web/packages/auth/src/session.ts` (refactor completo) + `packages/auth/src/middleware.ts:64` (transparente) | `setSessionCookies` ya NO emite `sameSite='lax'`. Delega en `@segurasist/security/cookie.setSessionCookiesForNames`, que aplica `sameSite='strict'` por construcción. El silent-refresh (línea :64 del middleware, vía `setSessionCookies(res, tokens)`) hereda strict transparentemente. Test regression añadido en `middleware.test.ts`: `expect(sessionCookie).toMatch(/SameSite=Strict/i)`. |
| **H-06** | High | `segurasist-web/apps/admin/app/api/auth/[...nextauth]/route.ts:68` (transparente) | El callback de Cognito (action='callback') sigue invocando `setSessionCookies(res, tokens)` desde `@segurasist/auth/session`. Como ese módulo ahora delega en `@segurasist/security/cookie`, el callback emite `sameSite='strict'` automáticamente. Misma raíz que C-11, mismo fix. |
| **H-07** | High | `segurasist-web/apps/admin/app/api/auth/[...nextauth]/route.ts:77-86,86` | Eliminado `export const POST = GET`. GET ahora retorna 405 cuando `action='logout'`. Nuevo handler `POST` exclusivo para logout: ejecuta `checkOrigin({method, pathname, origin})` (defense-in-depth, además del middleware) y solo entonces `clearSessionCookies + redirect(buildLogoutUrl())`. PKCE/STATE cookies migradas a `sameSite='strict'` por consistencia. |
| **H-19** | High | `segurasist-web/apps/{admin,portal}/lib/cookie-config.ts` + `apps/{admin,portal}/lib/origin-allowlist.ts` | 4 archivos byte-idénticos consolidados a re-exports / wrappers delgados sobre `@segurasist/security/{cookie,origin}`. APIs públicas preservadas (`buildSessionCookie`, `isSecureContext`, `checkOrigin({method,pathname,origin})`) → consumers existentes (local-login, portal-otp-verify, middlewares) no requieren cambios. |

### Paquete nuevo creado

`segurasist-web/packages/security/`:

```
package.json          @segurasist/security workspace:* + exports cookie/origin/proxy
tsconfig.json         extends @segurasist/config/tsconfig.lib.json
vitest.config.ts      thresholds 80/75/80/80 (security-critical, ver AUDIT_INDEX.md tabla coverage)
src/cookie.ts         SESSION_COOKIE_BASE + setSessionCookies(strict) + buildSessionCookie + clearSessionCookies + isSecureContext
src/origin.ts         checkOrigin (primitivo) + checkOriginAdvanced (webhook-aware) + mergeAllowlist
src/proxy.ts          makeProxyHandler({cookieName, originAllowlist, apiBase}) → Next route handler
src/index.ts          re-exports
test/cookie.spec.ts   17 specs
test/origin.spec.ts   14 specs
test/proxy.spec.ts    9 specs
```

### Tests añadidos

| Archivo | # specs | Cubre |
|---|---|---|
| `packages/security/test/cookie.spec.ts` | 17 | `SESSION_COOKIE_BASE` shape; `isSecureContext` allowlist (production/staging vs `prod`/`production-staging`/empty); `buildSessionCookie` strict/secure flip; `setSessionCookies` con/sin refresh, defaults, secure flip; `setSessionCookiesForNames` shim; `clearSessionCookies` ambas cookies expiradas |
| `packages/security/test/origin.spec.ts` | 14 | `checkOrigin` primitivo (missing-origin allowed, match, mismatch, empty allowlist, case-sensitive); `checkOriginAdvanced` (GET/HEAD/OPTIONS bypass, webhook prefix default + override, missing-origin, foreign-origin, configured + base allowlist, lowercase verb gate); `mergeAllowlist` (4 paths); `DEFAULT_WEBHOOK_PATH_PREFIXES` |
| `packages/security/test/proxy.spec.ts` | 9 | 403 origin invalid; 401 sin session; GET con Bearer + query; POST con body; cookie NO se propaga upstream; `x-trace-id` propagado; hop-by-hop response headers droppeados; missing Origin allowed (consistente con primitivo); upstream 5xx propagado |
| `packages/auth/src/middleware.test.ts` (extendido) | +1 assertion | C-11 regression: `SameSite=Strict` en silent-refresh path |
| `packages/auth/src/session.test.ts` (ajustado) | NODE_ENV pin | beforeEach setea `NODE_ENV='production'` (la nueva ruta lee env-allowlist en runtime para el flag secure) |

Total: **41 specs nuevos / extendidos**.

### Tests existentes corridos

❌ **Sandbox bloqueó ejecución de pnpm/vitest** (Bash deny). No pude correr:

- `cd segurasist-web && pnpm --filter @segurasist/security test`
- `cd segurasist-web && pnpm --filter @segurasist/auth test`
- `cd segurasist-web/apps/admin && pnpm test:unit` (cookie-config.test.ts + origin-allowlist.test.ts)
- `cd segurasist-web/apps/portal && pnpm test:unit`

Mitigación: revisión exhaustiva de cada test contra el patrón existente. Los re-exports de `apps/{admin,portal}/lib/cookie-config.ts` exponen `isSecureContext` + `buildSessionCookie` con la misma firma; los tests usan `vi.stubEnv('NODE_ENV', ...)` que afecta a `process.env` global → la implementación del paquete los lee en runtime (no en module-load) → comportamiento idéntico. Los tests de `origin-allowlist.test.ts` static-importan `checkOrigin({method,pathname,origin})` cuya signatura está preservada en el wrapper.

F0 debe correr la suite completa en gate D3. Si hay falla, el contrato es: feed entry `BLOCKED-test-failure` con stack trace.

### Symlinks manuales

Como `pnpm install` no se permite ejecutar (regla iter 1), agregué symlinks para que los tests existentes resuelvan `@segurasist/security`:

```
segurasist-web/packages/auth/node_modules/@segurasist/security  → ../../../security
segurasist-web/apps/admin/node_modules/@segurasist/security     → ../../../../packages/security
segurasist-web/apps/portal/node_modules/@segurasist/security    → ../../../../packages/security
```

F0 debe correr `pnpm install` antes del merge final para regenerar `pnpm-lock.yaml` y materializar los links de forma reproducible.

### Cross-cutting findings (NEW-FINDING al feed)

1. **`apps/{admin,portal}/lib/jwt.ts` NO son byte-idénticos** — el audit H-19 lo asumía (entrada del INDEX dice "lib/jwt.ts si existe"). Portal `jwt.ts` agrega `readFirstNameFromToken`, `readExpFromToken`, `isTokenExpired`. Consolidación posible a `packages/security/jwt.ts` (o `packages/auth/jwt.ts`) requiere coordinar con F10 (B-DRY) en iter 2: extraer base común (`decodeJwtPayload` + `readRoleFromToken`) y mantener helpers portal-only. NO bloquea iter 1; lo dejé tal cual.

2. **`packages/security/` requiere `pnpm install`** — el paquete nuevo no aparece en `pnpm-lock.yaml`. F0 debe ejecutar install antes de merge a main. Mientras, los symlinks manuales permiten correr tests locales.

3. **F2 puede simplificar `apps/portal/app/api/proxy/[...path]/route.ts` en iter 2** — con `makeProxyHandler` disponible, el route puede colapsar a 5 líneas. Plantilla incluida en `feed/F7-iter1.md` para que F2 la consuma directamente.

## Iter 2 (ejecutada)

### Issues cerrados

| ID | File:line | Descripción del fix |
|---|---|---|
| **NEW-FINDING #1 iter1** (jwt.ts admin↔portal drift) | `packages/security/src/jwt.ts` (NUEVO), `apps/admin/lib/jwt.ts` (refactor → re-exports), `apps/portal/lib/jwt.ts` (refactor → re-exports + portal-only helpers locales) | Decisión de arquitectura: `packages/security/jwt.ts` (no `packages/auth/jwt.ts`) — los helpers son **decode unverified**, son same-shape que cookie/origin (utility primitives consumidos por middlewares Edge) y `packages/auth` ya depende de `packages/security` (la inversa traería ciclo). Base común: `decodeJwtPayload<T>` (genérico), `readRoleFromToken`, `readExpFromToken`, `isTokenExpired({nowSeconds?, skewSeconds?})`. Portal preserva `readFirstNameFromToken` (helper greeting Cognito-specific) y un wrapper de `isTokenExpired(token, nowSeconds?)` con signatura legacy posicional para no romper `portal/middleware.ts:86`. Admin se reduce a un re-export de los 2 símbolos que su middleware consume. |

### Tests añadidos

| Archivo | # specs | Cubre |
|---|---|---|
| `packages/security/test/jwt.spec.ts` | 14 | `decodeJwtPayload` (well-formed, empty/single/empty-payload, non-JSON/array/garbage, no-throw); `readRoleFromToken` (custom:role, fallback role, preference, malformed/non-string); `readExpFromToken` (numeric, missing/non-numeric/non-finite); `isTokenExpired` (missing-as-expired default, before/at/after exp, skewSeconds margin, fallback Date.now() with vi.useFakeTimers) |

Total iter 2: **14 specs nuevos**. Acumulado F7: **55 specs**.

### Subpath export

`packages/security/package.json` actualizado:
```json
"exports": {
  ".": "./src/index.ts",
  "./cookie": "./src/cookie.ts",
  "./origin": "./src/origin.ts",
  "./proxy": "./src/proxy.ts",
  "./jwt": "./src/jwt.ts"
}
```

`packages/security/src/index.ts` agrega `export * from './jwt';` para callers que prefieren un import-line único.

### Coordinación verificada

- **F10 (B-DRY)**: el extract a `packages/security/jwt.ts` es la decisión consensuada en F7-iter1 NEW-FINDING #1. F10 no tocó `lib/jwt.ts` en su iter 1 (solo `where-builder.ts` backend). No hay conflicto.
- **pnpm-workspace.yaml**: el glob `packages/*` (línea 3) ya captura `packages/security/` — no requiere edit. F0 confirma con `pnpm install` en gate final.
- **middleware.test.ts (C-11 regression)**: línea 81 `expect(sessionCookie).toMatch(/SameSite=Strict/i)` intacta. F2 iter 2 modificó `apps/portal/app/api/proxy/[...path]/route.ts` y F6 modificó `auth.service.ts` — ninguno toca `packages/auth/src/middleware.{ts,test.ts}`.
- **Symlinks iter 1**: `apps/{admin,portal}/node_modules/@segurasist/security` ya apuntan a `packages/security/` físico. El nuevo subpath `@segurasist/security/jwt` resuelve transparentemente vía el `exports` map. No requieren symlinks adicionales.

### Backward-compat

Los 3 consumers existentes mantienen su API:

1. `apps/admin/middleware.ts:4` → `import { readRoleFromToken } from './lib/jwt';` ✅ (re-export presente).
2. `apps/portal/middleware.ts:3` → `import { decodeJwtPayload, isTokenExpired } from './lib/jwt';` ✅ (re-export + wrapper con signatura legacy preservados).
3. `apps/portal/lib/insured-session.ts:3` → `import { readFirstNameFromToken } from './jwt';` ✅ (helper portal-only retenido en su file local).
4. `apps/admin/test/unit/lib/jwt.test.ts:5` → `from '../../../lib/jwt'` con `{ decodeJwtPayload, readRoleFromToken }` ✅ (re-export expone ambos símbolos).

### Tests existentes corridos

❌ Sandbox sigue bloqueando `pnpm test`. F0 debe correr en gate D3:
- `pnpm --filter @segurasist/security test` (cookie 17 + origin 14 + proxy 9 + jwt 14 = 54 specs).
- `pnpm --filter @segurasist/admin test:unit` (jwt.test.ts es regression check del re-export — debe seguir verde por construcción).
- `pnpm --filter @segurasist/portal test:unit` (insured-session si tiene specs que tocan readFirstNameFromToken).

Mitigación: revisión manual byte-a-byte. El payload-decoding pipeline en `packages/security/src/jwt.ts:35-50` es idéntico al original (mismo regex `-→+` `_→/`, mismo padding `(4 - len%4) % 4`, misma guardia `obj && typeof obj === 'object' && !Array.isArray(obj)`). `readFirstNameFromToken` se preserva 1:1 en `apps/portal/lib/jwt.ts`. La signatura `isTokenExpired(token, nowSeconds?)` queda envuelta sobre la nueva `(token, options)` sin cambio observable para callers.

## Compliance impact (iter 2 adicional)

| Control | Estado pre-iter2 | Estado post-iter2 |
|---|---|---|
| Cross-cutting P7 (DRY admin↔portal) — `lib/jwt.ts` | 2 archivos near-duplicate (drift hazard: una fix a base64url-decoding tocaría sólo un app) | OK — 1 base en `packages/security/jwt.ts`, 2 facades de re-export con helpers app-specific aislados |
| Defensa contra config-drift en helpers Edge | Cada app evolucionaba independiente (portal añadió 3 helpers que admin no tiene) | OK — base común versionada en paquete; helpers app-specific siguen siendo legítimos pero son explícitos en su `lib/jwt.ts` |

## Lecciones para DEVELOPER_GUIDE.md (iter 2 adicional)

6. **DRY ≠ identidad byte-a-byte.** `lib/jwt.ts` admin↔portal NO eran byte-idénticos (portal tenía 3 helpers extra), pero la base común `decodeJwtPayload + readRoleFromToken` SÍ lo era. El pattern correcto: extraer la base al paquete (re-exportable), y dejar los helpers app-specific en el `lib/` local — NO copy-paste forzado a paridad. El facade local declara "qué de la base + qué local" en una sola lectura.

7. **Subpath exports `./jwt`.** `@segurasist/security/jwt` (vs flat `@segurasist/security`) preserva tree-shaking en builds Edge donde cada KB importa. Cookie/origin/proxy/jwt son ejes ortogonales — un middleware de admin que sólo lee role NO debe tirar `proxy.ts`. Adoptar subpath exports en cada nuevo paquete: el costo es 1 línea en `package.json#exports`, el beneficio es bundle hygiene gratis.

8. **Backward-compat en facades de paquete.** El portal tenía `isTokenExpired(token, nowSeconds?: number)` posicional. La nueva firma del paquete es `(token, { nowSeconds?, skewSeconds? })` — más extensible. El facade `apps/portal/lib/jwt.ts` envuelve con la signatura legacy para no obligar a F2/F6/futuros agentes a refactorear callers ortogonales en el mismo PR. Patrón: el paquete exporta la API mejor; los facades preservan la API histórica vía wrapper de 1 línea.

## Compliance impact

| Control | Estado pre-fix | Estado post-fix |
|---|---|---|
| 3.13 OWASP A07 Identification & Auth (cookie hardening completo) | Parcial: cookie-config apps OK, packages/auth `lax` | OK 100% — single source of truth en packages/security |
| M6 sameSite consolidado (audit baseline) | Roto en silent-refresh + Cognito callback | OK — strict por construcción en TODA ruta de write |
| 3.13 OWASP A01 Broken Access Control (CSRF logout) | Roto: GET `/api/auth/logout` ejecutable cross-site (image tag, link prefetch) | OK — POST + Origin gate |
| Cross-cutting P2 (cookie/CSRF wiring fragmentado) | 7 sites independientes con drift potencial | OK — 1 factory, 6 consumers re-exportando |
| Cross-cutting P7 (DRY admin↔portal) | 4 archivos byte-idénticos | OK — 4 wrappers de ≤30 líneas que delegan al paquete |

## Lecciones para DEVELOPER_GUIDE.md

1. **Single source of truth para cookie security.** Cualquier endpoint que escriba una cookie de sesión va por `@segurasist/security/cookie`. Los re-exports en `apps/*/lib/cookie-config.ts` existen sólo para preservar imports legacy — código nuevo importa directo del paquete. El factory FUERZA `sameSite='strict'`; no hay opción de relajar a `lax` (audit C-11 fue exactamente eso).

2. **`secure` es allowlist NODE_ENV, no `=== 'production'`.** Defensa contra config drift: `NODE_ENV='prod'` o `'production-staging'` NO emiten Secure. Si necesitas un nuevo env productivo, agrégalo explícitamente a `PRODUCTION_LIKE_ENVS` en `packages/security/src/cookie.ts` — ese cambio amerita revisión obligatoria.

3. **Logout JAMÁS via GET.** SameSite=Strict no protege un GET top-level (image tag, navegación, prefetch). Toda mutación de sesión es POST + checkOrigin. El handler nuevo en `apps/admin/app/api/auth/[...nextauth]` retorna 405 explícito en GET.

4. **Defense-in-depth Origin: middleware + handler.** Aunque `apps/{admin,portal}/middleware.ts` ya valida Origin, los handlers state-changing (logout, proxy, OTP verify) re-validan localmente. Razón: si el matcher del middleware se desconfigura, el endpoint queda expuesto. Costo: 5 líneas por handler. Beneficio: una clase entera de regresiones imposible.

5. **Patrón "primitivo + advanced" para reglas reusables.** `checkOrigin(req, allowlist)` es un boolean simple para uso embedded (proxy factory). `checkOriginAdvanced({method, pathname, origin}, options)` es la decisión completa con webhook exemptions y razones de rechazo. Apps componen el primero; la per-app `lib/origin-allowlist.ts` envuelve el segundo. Replicar este pattern para futuros consolidations evita over-coupling.
