# Fix Report — F2 B-PORTAL-AUTH + B-CSP

## Iter 1 (resumen)

### Issues cerrados

| ID | SEV | File:line | Descripción del fix |
|---|---|---|---|
| **C-02** | Critical | `segurasist-web/apps/portal/app/api/proxy/[...path]/route.ts:2,13` | Reemplazado `import { SESSION_COOKIE } from '@segurasist/auth'` por `import { PORTAL_SESSION_COOKIE } from '../../../../lib/cookie-names'`. El proxy ahora lee `sa_session_portal` (cookie real del portal) en vez de `sa_session` (cookie del admin) → todos los requests upstream llevan `Authorization: Bearer <idToken>` correcto. |
| **C-03** | Critical | `segurasist-api/src/modules/auth/auth.service.ts:307-340` (anteriormente 300-326) | Añadido `persistCognitoSubFromTokens()` post-Cognito-success: decodifica el `idToken` (fallback `accessToken`) con `jose.decodeJwt` y persiste `claims.sub` vía `prismaBypass.client.insured.update({ where: { id }, data: { cognitoSub } })`. Errores se loguean como WARN — el OTP exitoso NO se rompe por una falla de BD. |
| **H-04** | High | `segurasist-web/apps/portal/app/api/proxy/[...path]/route.ts:23-31` | Invocación de `checkOrigin({ method, pathname, origin })` al inicio del handler. Rechazo 403 con `{ error: 'origin-rejected', reason }` si Origin no está en allowlist. Documentado por qué duplicamos el check ya cubierto por middleware (defense-in-depth + tests aislados del handler). |
| **H-05** | High | `segurasist-web/apps/portal/next.config.mjs:27-37` | Añadida directiva `frame-src 'self' https://*.s3.mx-central-1.amazonaws.com https://*.cloudfront.net`. Conserva `frame-ancestors 'none'` (anti-clickjacking, ortogonal). |
| **H-05b** | High (preventiva) | `segurasist-web/apps/admin/next.config.mjs:36-49` | Mismo `frame-src` aplicado a admin para que la regresión no se reintroduzca cuando el admin agregue preview de cert en Sprint 4+. |

### Tests añadidos

| Archivo | # specs | Cubre |
|---|---|---|
| `segurasist-api/test/integration/otp-flow.spec.ts` | 6 | C-03 happy path; fallback accessToken; BD-down resilience; BYPASS deshabilitado; JWT sin `sub`; código inválido NO llama BD |
| `segurasist-web/apps/portal/test/integration/csp-iframe.spec.ts` | 6 | H-05 frame-src declarado; S3 mx-central-1; CloudFront; `'self'`; `frame-ancestors 'none'` intacto; H-05b admin mirror |

### Tests existentes corridos

❌ **Sandbox bloqueó `pnpm test`** (Bash deny). No pude ejecutar localmente:

- `cd segurasist-api && pnpm test -- --testPathPattern=otp-flow` — pendiente
- `cd segurasist-web/apps/portal && pnpm test` — pendiente

Mitigación: revisión cuidadosa de cada test contra el patrón de tests existentes (`auth.service.spec.ts`, `cert-email-flow.spec.ts`, `origin-allowlist.test.ts`). F0 debe correr la suite en gate D4. Si hay falla, el contrato es claro: feed entry `BLOCKED-test-failure` con stack trace.

### Cross-cutting findings (NEW-FINDING al feed)

1. **H-09 sigue abierto** — `auth.service.spec.ts:95` tiene `describe.skip('otpRequest/otpVerify')`. Mi `otp-flow.spec.ts` cubre **sólo** el path C-03 (persistencia de `cognito_sub`) — el flow completo (anti-enum, rate limit por CURP, lockout) sigue sin coverage unitaria. Recomendación: F9 lo integra en `B-TESTS-OTP`.
2. **Cache `.next/`** — el build cache del portal tiene `cookie-names.ts` inlined (search resultado del grep). Tras merge, necesario `pnpm build` limpio o `rm -rf .next` para purgar artefactos. F10 debería documentarlo en `DEVELOPER_GUIDE.md`.

## Iter 2 (ejecutada)

### Follow-ups cerrados

| ID | File:line | Descripción del fix |
|---|---|---|
| **proxy-migration** | `segurasist-web/apps/portal/app/api/proxy/[...path]/route.ts` (rewrite completo) | Migrado de handler manual (72 LOC) a `makeProxyHandler({ cookieName, originAllowlist, apiBase })` del paquete `@segurasist/security/proxy` (F7). El nuevo route.ts tiene 32 LOC (5 efectivos + comments preservando rationale de C-02/H-04). Contrato HTTP idéntico: 403 origin invalid, 401 missing-cookie, Bearer forwarding, hop-by-hop drop, x-trace-id propagation. Import del cookie name via alias `@/lib/cookie-names` (tsconfig `baseUrl='.'`). Symlink `@segurasist/security` ya existe en `apps/portal/node_modules` (creado por F7 iter1). |
| **post-F6-verification** | `segurasist-api/src/modules/auth/auth.service.ts:307-340,352-389` | Re-leído auth.service.ts post-F6-iter1: F6 iter2 todavía no ejecutó (no existe `feed/F6-iter2.md`), pero el plan F6 declarado en feed (línea 76) confirma que migrará el audit log call (líneas 329-338, action='login') a `AuditContextFactory.fromRequest()` + nuevo enum `otp_verified`. Mi `persistCognitoSubFromTokens` (línea 326 invocación + 352-389 implementación) vive aguas arriba del audit call y NO comparte líneas. Sin conflict esperado en merge. |

### LOC delta

```
apps/portal/app/api/proxy/[...path]/route.ts:  -40 LOC (72 → 32)
                                              =====
                                              -55% reducción
```

### Tests existentes corridos

❌ **Sandbox bloqueó `pnpm test`** (Bash deny). El paquete F7 ya tiene 9 specs verdes documentados en `packages/security/test/proxy.spec.ts` que cubren la matriz completa (403 origin / 401 missing-cookie / GET-with-Bearer / POST-body / cookie-NOT-forwarded / x-trace-id / hop-by-hop drop / empty-origin allowed / upstream 5xx). Mi cambio en el consumer (route.ts del portal) es superficial — pasa de implementar a delegar — el contrato observable está enteramente en el factory. F0 debe correr en gate D4:

- `cd segurasist-web && pnpm --filter @segurasist/security test`
- `cd segurasist-web && pnpm --filter portal test`

### Cross-cutting findings (NEW-FINDING al feed)

1. **Cache `.next/` cleanup → F10** — paso explícito el NEW-FINDING #2 de iter1 a F10 para que lo agregue a `docs/fixes/DEVELOPER_GUIDE.md` sección 3 (Setup). Comando: `rm -rf segurasist-web/apps/{admin,portal}/.next` antes de `pnpm dev` tras pulls que toquen `lib/cookie-names.ts` o `packages/security/`. Razón: Next 14 inlinea constantes en chunks compilados; sin purgar, el dev server sirve PORTAL_SESSION_COOKIE viejo.

## Coordinación final

- **F7 (paquete security)**: consumido sin tocar. La firma `makeProxyHandler({cookieName, originAllowlist, apiBase})` matchea exactamente el plan declarado en `feed/F7-iter1.md` línea 74.
- **F6 (auth.service.ts audit ctx)**: cuando ejecute iter2 (líneas 231/329-338), el éxito-path de mi C-03 (líneas 326,352-389) queda intocado — son secciones contiguas pero no overlapped.
- **F10 (DEVELOPER_GUIDE.md)**: ver NEW-FINDING `.next/` cleanup arriba.

## Compliance impact

| Control | Estado pre-fix | Estado post-fix |
|---|---|---|
| 3.16 API Auth (cookie sameness portal) | Roto: proxy lee cookie del admin → 401 cascadeo | OK |
| 3.5 RBAC integridad insured (`cognito_sub` populated) | Roto: lookups `findFirst({where:{cognitoSub}})` siempre 404 tras C-02 | OK |
| 3.13 OWASP A01 Broken Access Control (CSRF gate proxy) | Parcial: middleware cubre, handler no | Defense-in-depth |
| 3.13 OWASP A05 Security Misconfiguration (CSP frame-src) | Roto: iframe S3 cae a default-src | OK |

## Lecciones para DEVELOPER_GUIDE.md

1. **Importar `*_COOKIE` de `lib/cookie-names.ts` SIEMPRE en portal.** Nunca de `@segurasist/auth` (ese paquete es del admin/legacy). Patrón replicable: cada app tiene su propio `lib/cookie-names.ts` re-exportable hacia `packages/security/` cuando F7 consolide.
2. **CSP `frame-src` ≠ `frame-ancestors`** — son directivas ortogonales. `frame-src` controla **qué iframes el origen propio puede embeber**; `frame-ancestors` controla **quién puede embeber a este origen**. El default-src fallback del primero es invisible en dev local pero rompe prod.
3. **Persistencia post-Cognito-success debe ser best-effort** — un OTP exitoso jamás debe romperse por una falla de BD secundaria. Pattern: `try { update } catch { log.warn }`. El estado se reconcilia en el siguiente login.
4. **JWTs recién emitidos por nuestro propio Cognito → `decodeJwt`** (no `jwtVerify`). Verificación de firma vive en `JwtAuthGuard` con JWKS — duplicarla aquí sólo agrega latencia. Defense-in-depth, no defense-in-redundancy.
5. **`prisma.update().where`** sólo admite campos `@unique` o el PK. Para insureds usar `{ id: insuredId }` (PK). `tenantId` se conserva en logs/audit pero no en el filtro.
