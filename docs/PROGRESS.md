# SegurAsist — Programa MVP — Progreso

| Fase | Estado | Notas |
|---|---|---|
| Sprint 0 — Cimientos | ✅ Completado | 3 repos bootstrapped (api 101 / web 173 / infra 161 archivos), 12 docs externas, dominio `.app`, región primaria `mx-central-1` |
| Sprint 1 — Auth + carga preview | ✅ Cerrado (S1-05 deferred) + Audit endurecido | Local-first stack docker-compose, RBAC 5 roles e2e green, **650 tests automatizados** (248 BE unit + 6 cross-tenant + 86 BE e2e + 148 admin unit + 108 ui unit + 54 auth unit). S1-09 cerrado con 3 specs Playwright reales (admin login) + 2 skip justificados (portal OTP/cert dependen de Sprint 3). Audit de seguridad: 13 items aplicados (3 HIGH, 6 MEDIUM, 4 LOW). S1-05 (validador upload) movido a Sprint 2 cuando MAC-002 desbloquee. |
| Sprint 2 — Carga end-to-end + Certificados | ⬜ Pendiente | |
| Sprint 3 — Portal asegurado + Dashboard | ⬜ Pendiente | |
| Sprint 4 — Reportes + Chatbot | ⬜ Pendiente | |
| Sprint 5 — Provisioning AWS + Endurecimiento + DR + Pentest | ⬜ Pendiente | Incluye AWS-001/002/003/004, SAML real, SES out-of-sandbox, WAF/GuardDuty |
| Sprint 6 — UAT + Go-Live | ⬜ Pendiente | |

## Bloqueos externos

Ver `external/` para el detalle de cada uno. Marcar `[x]` cuando se resuelva.

### Bloquean Sprint 1 (necesarios ya)

- [x] **MAC-002 — RESUELTO 2026-04-26**: Lucía dio libre albedrío. Layout v1 definido por SegurAsist (12 columnas + bajas separadas + beneficiarios CSV). Onboarding presencial Sprint 2 día 5.
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

## Riesgos operativos vigentes

> ⚠️ **Hasta Sprint 5 los buckets / logs / audit trail son MUTABLES.** El stack
> local-first (LocalStack + Postgres + CloudWatch dev) no tiene retención de
> evidencia inmutable. Si hay un incidente entre hoy y Sprint 5, la evidencia
> post-incidente puede haber sido alterada — **no aplica Object Lock COMPLIANCE
> retroactivamente**.

Detalle, mitigaciones y plan de cierre en [`docs/INTERIM_RISKS.md`](./INTERIM_RISKS.md).

Resumen rápido:

- **Audit log**: persiste en Postgres; restorable desde backup, no inmutable.
- **Buckets `audit/certificates/exports`**: mutables (LocalStack hoy, S3 sin Object Lock hasta S5).
- **Logs**: Docker `docker logs` + CloudWatch dev; sin retention policy ni firma.
- **Mitigación interim**: snapshots `pg_dump` diarios + dump de logs Docker archivados offline cifrados ante cualquier hallazgo.
- **Cierre**: Sprint 5 activa S3 Object Lock COMPLIANCE en buckets sensibles con retención 730 días (24 meses).

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

### Día 3 (2026-04-26)

| Story / item | Estado | Evidencia |
|---|---|---|
| Premium polish UX desktop (Linear/Vercel/Stripe) | ✅ Listo | tokens, Inter Variable + JetBrains Mono, sidebar Linear-style, KPI cards con sparklines, charts re-temados, dark/light toggle persistido, ⌘K palette, Framer motion |
| Mobile UX completo | ✅ Listo | drawer hamburguesa Radix Dialog, ⌘K bottom-sheet, touch targets ≥44px, safe-area iOS, KPI 2×2 mobile, `lg:` cutoff @1024 |
| RBAC matrix (5 roles e2e) | ✅ Listo | `cognito-local-bootstrap.sh` extendido a 5 users + `prisma/seed.ts` 5 filas + `test/e2e/rbac.e2e-spec.ts` con **71 tests**: matriz extraída de `@Roles()` reales, insured pool isolation verificado |
| FE role-aware sidebar + AccessDenied + insured redirect | ✅ Listo | `apps/admin/lib/rbac.ts` (NAV_ITEMS centralizado), `lib/auth-server.ts` (`fetchMe()`), middleware decode JWT redirige insured a `:3002`, `AccessDenied` placeholder, role chip dinámico |
| Unit testing comprehensive | ✅ Listo | **454 unit tests** total: 192 BE (services + guards + filters + pipes + prisma extends + AWS infra), 113 admin (rbac, jwt, auth-server, route handlers, components), 162 packages (ui + auth) |
| `/batches` server-component bug | ✅ Corregido | extraído `BatchesTable` a client component |
| **S1-04 — Layout XLSX template provisional** | ✅ Listo | `GET /v1/batches/template` con `LayoutsService.generateInsuredsTemplate()` usando exceljs. 3 hojas (Asegurados / Instrucciones / Catálogos), 11 columnas demo. RBAC `admin_segurasist`/`admin_mac`/`operator`. 13 unit + 6 e2e tests. Cuando MAC-002 desbloquee solo se actualiza el array `COLUMNS`. |
| **S1-06 — GitHub Actions CI** | ✅ Listo (en repo, no ejecutado hasta GH-001) | `.github/workflows/ci.yml` con paths-filter, jobs api-lint+typecheck/api-unit/api-e2e (con docker-compose + bootstrap completo)/web-lint+typecheck/web-unit + `ci-success` aggregate gate. README de `.github/` documenta el unblock path. |
| Git init + checkpoint | ✅ Listo | Repo en `main`, commit inicial `ff90834` (564 archivos, 62.9k líneas), `.gitignore` cubre env/node_modules/.next/.terraform/.claude. Listo para push a GitHub privado. |

**Sprint 1 cerrado** — la única historia pendiente es **S1-05** (validador de upload del layout masivo) que está bloqueada por **MAC-002** (la doctora Lucía no ha validado el layout oficial). Se mueve a Sprint 2 cuando se desbloquee, sin riesgo arquitectónico: el endpoint S1-04 ya está, el FE puede construir el flujo download/upload/preview con el demo.

### Día 4 (2026-04-26) — Audit de seguridad aplicado

Audit estructurado de cierre de Sprint 1 sobre commits `ff90834 + f8b9546 + cf1f2e7`. 13 items en 3 niveles (HIGH/MEDIUM/LOW). Aplicados con 4 subagentes paralelos:

| ID | Severidad | Item | Estado |
|---|---|---|---|
| H1 | 🔴 HIGH | Rate limiting real (Redis + APP_GUARD global, 60/min default, 5/min en auth) | ✅ |
| H2 | 🔴 HIGH | Audit log persistente en `audit_log` (BYPASSRLS via PrismaClient dedicado) | ✅ |
| H3 | 🔴 HIGH | Pool-aware JWT validation (aud claim + token_use, defensa role/pool en RolesGuard) | ✅ |
| M1 | 🟠 MED | HttpExceptionFilter preserva status original (503/415/etc.) | ✅ |
| M2 | 🟠 MED | `User.tenant_id NULLABLE` + superadmin con `prismaBypass` (rol `segurasist_admin`) | ✅ |
| M3 | 🟠 MED | `@Scopes` deprecado para MVP (Roles-only); reactivable Fase 2 | ✅ |
| M4 | 🟠 MED | `COGNITO_ENDPOINT` valida regex AWS en producción (anti-footgun) | ✅ |
| M5 | 🟠 MED | `pino` redact recursivo (`scrubSensitiveDeep`, depth 12) | ✅ |
| M6 | 🟠 MED | `sameSite=strict` + Origin allowlist en `local-login` + `middleware.ts` | ✅ |
| L1 | 🟡 LOW | Helmet CSP siempre activa (`default-src 'none'`, `frame-ancestors 'none'`) | ✅ |
| L2 | 🟡 LOW | Comment XSS sobre `dangerouslySetInnerHTML` del theme anti-FOUC | ✅ |
| L3 | 🟡 LOW | Cookie `secure` con allowlist explícita `{production, staging}` | ✅ |
| L4 | 🟡 LOW | Magic bytes en multipart upload (XLSX = ZIP + `xl/workbook.xml`; CSV = ASCII) | ✅ |
| L5 | 🟡 LOW | Riesgo retención mutable documentado en `INTERIM_RISKS.md` | ✅ |

**Tests añadidos por el audit: +96 (61 BE + 35 web)**:
- BE unit: +56 (192 → 248). Throttler, file-magic-bytes, scrub-sensitive, jwt-auth pool-aware, env.schema, http-exception status, audit interceptor.
- BE cross-tenant: +2 (4 → 6). BYPASSRLS lee cross-tenant, NOBYPASSRLS sin SET → 0 filas.
- BE e2e: +3 (83 → 86). Superadmin (`/v1/tenants` + `/me`), batches upload magic-bytes, security-headers integration.
- Web admin: +35 (113 → 148). Cookie-config (12), origin-allowlist (17), local-login Origin enforcement (5).

**ADRs nuevos**:
- [`0002-audit-log-persistence.md`](../segurasist-api/docs/adr/0002-audit-log-persistence.md) — BYPASSRLS, fire-and-forget, retención.
- [`0003-rbac-roles-only-mvp.md`](../segurasist-api/docs/adr/0003-rbac-roles-only-mvp.md) — scopes diferidos a Fase 2.
- [`0004-superadmin-nullable-tenant-bypass-rls.md`](../segurasist-api/docs/adr/0004-superadmin-nullable-tenant-bypass-rls.md) — modelo superadmin sin tenant.

### Backlog descubierto (Sprint 5)

- Logout button en topbar/drawer (no estaba en spec, no es seguridad).
- Tenant switcher real (sigue mock con mac/demo).
- Object Lock COMPLIANCE en buckets `audit/certificates/exports` (planeado Sprint 5; ver INTERIM_RISKS).
- Pre Token Generation Lambda en Cognito si reactivamos `@Scopes` (Fase 2).

## Decisiones técnicas vivas

Cualquier ADR nuevo se publica en `segurasist-infra/docs/adr/` y se referencia desde el doc Arquitectura en su próxima versión.

### Cambios respecto a la Suite documental v1.0 (2026-04-25)

| Cambio | Razón | ADR |
|---|---|---|
| Dominio `segurasist.mx` → `segurasist.app` | Decisión del cliente; `.app` fuerza HTTPS via HSTS preload | (cosmético, sin ADR) |
| Región primaria `us-east-1` → `mx-central-1` | Requerimiento de Roy/MAC: residencia primaria de datos en MX | [ADR-014](../segurasist-infra/docs/adr/014-region-primaria-mx-central-1.md) |
| DR `us-east-2` → `us-east-1` | Consecuencia del cambio anterior; `us-east-1` tiene mayor disponibilidad de servicios y ya hospeda ACM-for-CloudFront | [ADR-012 (revisado)](../segurasist-infra/docs/adr/012-cross-region-dr-us-east-1.md) |
