# SegurAsist — Programa MVP — Progreso

| Fase | Estado | Notas |
|---|---|---|
| Sprint 0 — Cimientos | ✅ Completado | 3 repos bootstrapped (api 101 / web 173 / infra 161 archivos), 12 docs externas, dominio `.app`, región primaria `mx-central-1` |
| Sprint 1 — Auth + carga preview | 🟡 En curso | **Local-first**: stack en docker-compose (postgres, redis, localstack, mailpit, cognito-local). Ver `docs/LOCAL_DEV.md`. AWS real diferido a Sprint 5. |
| Sprint 2 — Carga end-to-end + Certificados | ⬜ Pendiente | |
| Sprint 3 — Portal asegurado + Dashboard | ⬜ Pendiente | |
| Sprint 4 — Reportes + Chatbot | ⬜ Pendiente | |
| Sprint 5 — Provisioning AWS + Endurecimiento + DR + Pentest | ⬜ Pendiente | Incluye AWS-001/002/003/004, SAML real, SES out-of-sandbox, WAF/GuardDuty |
| Sprint 6 — UAT + Go-Live | ⬜ Pendiente | |

## Bloqueos externos

Ver `external/` para el detalle de cada uno. Marcar `[x]` cuando se resuelva.

### Bloquean Sprint 1 (necesarios ya)

- [ ] MAC-002: Layout oficial validado con Lucía (columnas y reglas) — necesario para validador de carga masiva (S1-05)
- [ ] OPS-004: Slack workspace `segurasist` + canales `#segurasist-*` — comunicación de equipo

### Bloquean Sprint 5 (provisioning + endurecimiento, no urgentes ahora)

- [ ] AWS-001: Cuentas AWS Organizations (root, security, dev, staging, prod)
- [ ] AWS-002: Salida de sandbox SES con caso de uso MAC
- [ ] AWS-003: Dominio segurasist.app + Route 53 hosted zone + ACM (regional + us-east-1)
- [ ] AWS-004: Verificar disponibilidad de servicios en mx-central-1
- [ ] GH-001: GitHub Org + 3 repos privados + Branch Protection + Advanced Security
- [ ] GH-002: GitHub Actions OIDC con AWS (rol `github-actions-deploy`)
- [ ] MAC-001: Federación SAML/OIDC con Azure AD MAC (credenciales SP)
- [ ] LEG-001: DPA AWS firmado + Aviso de Privacidad publicado
- [ ] OPS-001: 1Password Business vault Equipo + onboarding
- [ ] OPS-002: PagerDuty Free Tier + on-call schedule
- [ ] OPS-003: UptimeRobot Pro (50 monitors)

> **Nota:** los bloqueos AWS/GH/MAC-001/LEG/OPS-001..003 pueden gestionarse en paralelo en consola durante Sprints 1–4. No compiten con desarrollo.

## Sprint 1 — Detalle de avance

### Día 1 (2026-04-25)

| Story | Pts | Estado | Evidencia |
|---|---|---|---|
| S1-02 — Migración core PostgreSQL + RLS por `tenant_id` | 8 | ✅ Listo (pendiente verificar contra Postgres real) | Migración baseline regenerada (`prisma/migrations/20260425_init_schema/`); `prisma/rls/policies.sql` separado; `scripts/apply-rls.sh`; tests `test/security/cross-tenant.spec.ts` (4 casos RLS-layer). `typecheck`/`lint`/`build` ✅. |
| S1-03 — Middleware tenant_id desde JWT | 5 | ✅ Listo | PrismaService reescrito con `$extends.query.$allOperations` envolviendo cada op en `$transaction` para que `SET LOCAL app.current_tenant` y la query compartan conexión (el `$use` original estaba roto por pool de conexiones). `JwtAuthGuard` con override `COGNITO_ENDPOINT` para cognito-local. |
| S1-08 — Design system + Storybook | 8 | ✅ Listo | 26 componentes REAL (Button, Input, Form, DataTable, Dialog, Toast, etc.) en `packages/ui`. Storybook builda. Admin (3001) y portal (3002) bootean y renderizan componentes con tokens CSS. |
| Infra local — bootstrap scripts | — | ✅ Listo | `scripts/localstack-bootstrap.sh` (4 buckets, 4 colas, KMS alias) y `scripts/cognito-local-bootstrap.sh` (2 pools, 2 clients, admin user con `custom:tenant_id` + sync `users.cognito_sub`). |

**Bugs de Sprint 0 detectados y corregidos:**
- Migración RLS referenciaba tablas inexistentes (orden incorrecto).
- PrismaService `$use` no compartía conexión con el `SET LOCAL` (RLS habría bloqueado todo en runtime).
- `JwtAuthGuard` con issuer hardcodeado a AWS (sin escape para cognito-local).
- Puertos admin/portal invertidos vs `LOCAL_DEV.md` (admin=3000 → 3001, portal=3001 → 3002).
- `@segurasist/auth` no re-exportaba símbolos que admin/portal importaban.

**Stack local arriba (2026-04-25):** Docker Desktop + AWS CLI + libpq + jq instalados. `./scripts/local-up.sh` corre extremo a extremo: 5 contenedores healthy (postgres, redis, localstack, mailpit, cognito-local), LocalStack con 4 buckets (versioning en certificates/audit) + 4 colas SQS + KMS alias, Prisma migrate aplicada, RLS aplicada, seed creó tenant `mac` (`797bd87f-…`), cognito-local con 2 pools (`local_4DmXgeQK`, `local_0KGZfpMl`) + 2 clients + admin user (`admin@mac.local`/`Admin123!`) con `custom:tenant_id` y `users.cognito_sub` sincronizado contra el sub real (`91f9d7ab-…`). `.env` poblado con los IDs reales.

### Día 2 (2026-04-25)

| Story | Pts | Estado | Evidencia |
|---|---|---|---|
| S1-01 — Wireup login admin (BE+FE) | 8 | ✅ Listo | **BE**: `CognitoService.loginAdmin/refresh/revoke` implementados contra `AdminInitiateAuthCommand`; `test/e2e/auth.e2e-spec.ts` con 6/6 PASS (login OK, login pwd inválida, login email inexistente, me sin auth, me con bearer, logout). **FE**: `apps/admin/app/(auth)/login/page.tsx` con form email+password (Form/Input/Button de `@segurasist/ui`), proxy server-side `app/api/auth/local-login/route.ts` que mapea tokens de la API a cookies httpOnly `sa_session`/`sa_refresh`, dashboard placeholder con email del user vía `/v1/auth/me`. Middleware protege todo excepto `/login` + `/api/auth/*`. Verificado curl-end-to-end: login OK, password inválida → 401 + UI message, sin cookie → 307 a `/login?next=/dashboard`. |
| S1-02 verify — Cross-tenant RLS contra DB real | — | ✅ Listo | `npm run test:cross-tenant` ejecutó las 4 aserciones reales (NO skip): sin SET LOCAL → 0 filas; tenant A → solo A; ID de B con context A → null; INSERT B con context A → falla por `WITH CHECK`. Evidencia auditable para Sprint 5 pentest. |

**Bugs detectados y corregidos en Día 2:**
- Issuer mismatch cognito-local: emite `iss=http://0.0.0.0:9229/<poolId>` (no `localhost`). `.env` y `local-up.sh` actualizados; `JwtAuthGuard` valida correctamente.
- `CognitoService` era un stub con `NotImplementedException` — implementadas 3 ops admin (login/refresh/revoke). `startInsuredOtp`/`verifyInsuredOtp` siguen pendientes (Sprint 3).
- `AuthController.login` devuelve `AuthTokens` en body (no Set-Cookie); el FE proxy `/api/auth/local-login` traduce a cookies httpOnly same-origin para el browser.
- Bugs pre-existentes admin (corregidos como side-effect FE): `initialsOf` cruzando boundary `'use client'`, `Link href` con typedRoutes, columnas DataTable con funciones en server component.

### Pendiente Día 3

- Verificar `/v1/auth/me` end-to-end con el `.env` corregido (`COGNITO_ENDPOINT=http://0.0.0.0:9229`) — reiniciar `npm run dev` y refrescar `/dashboard`.
- Setup Vitest en `apps/admin` (config + jsdom + testing-library) y escribir tests del form de login.
- S1-04: endpoint descarga layout plantilla `.xlsx` (provisional hasta MAC-002).
- S1-06: GitHub Actions CI workflow listo en `.github/workflows/` aunque GH-001 esté bloqueado.

## Decisiones técnicas vivas

Cualquier ADR nuevo se publica en `segurasist-infra/docs/adr/` y se referencia desde el doc Arquitectura en su próxima versión.

### Cambios respecto a la Suite documental v1.0 (2026-04-25)

| Cambio | Razón | ADR |
|---|---|---|
| Dominio `segurasist.mx` → `segurasist.app` | Decisión del cliente; `.app` fuerza HTTPS via HSTS preload | (cosmético, sin ADR) |
| Región primaria `us-east-1` → `mx-central-1` | Requerimiento de Roy/MAC: residencia primaria de datos en MX | [ADR-014](../segurasist-infra/docs/adr/014-region-primaria-mx-central-1.md) |
| DR `us-east-2` → `us-east-1` | Consecuencia del cambio anterior; `us-east-1` tiene mayor disponibilidad de servicios y ya hospeda ACM-for-CloudFront | [ADR-012 (revisado)](../segurasist-infra/docs/adr/012-cross-region-dr-us-east-1.md) |
