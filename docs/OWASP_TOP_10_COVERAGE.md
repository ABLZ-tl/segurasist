# OWASP Top 10 (2021) — Cobertura SegurAsist

> **Owner**: Tech Lead (acumula CISO en MVP)
> **Última auditoría interna**: 2026-04-26
> **Próxima auditoría externa**: Sprint 5 — pre-pentest inicial (proveedor TBD)
> **Documentos relacionados**: [`PROGRESS.md`](./PROGRESS.md) · [`IRP.md`](./IRP.md) · [`SUB_PROCESSORS.md`](./SUB_PROCESSORS.md) · [`INTERIM_RISKS.md`](./INTERIM_RISKS.md)

Auto-evaluación de cobertura sobre OWASP Top 10 versión **2021** (la 2024 está en draft a esta fecha). El alcance es la plataforma SegurAsist: API NestJS + Postgres con RLS + Cognito User Pools + Next.js admin/portal. Honesto sobre gaps; lo que es Sprint 5 está marcado.

## Tabla de contenidos

- [A01 — Broken Access Control](#a012021--broken-access-control)
- [A02 — Cryptographic Failures](#a022021--cryptographic-failures)
- [A03 — Injection](#a032021--injection)
- [A04 — Insecure Design](#a042021--insecure-design)
- [A05 — Security Misconfiguration](#a052021--security-misconfiguration)
- [A06 — Vulnerable and Outdated Components](#a062021--vulnerable-and-outdated-components)
- [A07 — Identification and Authentication Failures](#a072021--identification-and-authentication-failures)
- [A08 — Software and Data Integrity Failures](#a082021--software-and-data-integrity-failures)
- [A09 — Security Logging and Monitoring Failures](#a092021--security-logging-and-monitoring-failures)
- [A10 — Server-Side Request Forgery](#a102021--server-side-request-forgery)
- [Resumen ejecutivo](#resumen-ejecutivo)

---

## A01:2021 — Broken Access Control

**Riesgo**: usuarios obtienen acceso a recursos fuera de su rol o tenant; superadmin sin frontera; rutas admin accesibles a insureds.

**Controles aplicados**:
- ✅ RBAC con 5 roles (`admin_segurasist`, `admin_mac`, `operator`, `supervisor`, `insured`) vía `RolesGuard` + decorador `@Roles()`. **71 e2e** cubren la matriz completa, extraída de los `@Roles()` reales de cada controller.
- ✅ Row-Level Security PostgreSQL por `tenant_id`. **6 cross-tenant tests reales** (4 cliente NOBYPASSRLS + 2 cliente BYPASSRLS) verifican aislamiento en SQL real, no mockeado.
- ✅ Pool isolation tipada: `JwtAuthGuard` valida `aud` claim + `token_use` y `RolesGuard` reverifica que el `pool` del JWT coincida con el rol esperado. Un JWT del pool `insured` no puede pasar por endpoints admin aunque el rol sea spoofeado.
- ✅ Insured redirect: middleware Next.js decode el JWT y redirige automáticamente a `:3002` (portal) si el rol es `insured`, evitando que aterrice en admin.
- ✅ AccessDenied page para deep-link no autorizado (en lugar de error 500).
- ✅ DB role separation: `segurasist_app` con `NOBYPASSRLS` (rol de aplicación) vs `segurasist_admin` con `BYPASSRLS` (sólo migraciones y mantenimiento; no expuesto a runtime).
- ✅ Superadmin (`admin_segurasist`) usa `prismaBypass` (instancia separada con `segurasist_admin`) sólo en endpoints explícitamente permitidos (`/v1/tenants`).
- ✅ Audit interceptor registra cada operación mutativa con `actor_id`, `tenant_id`, `action`, `resource_*` en tabla `audit_log` (BYPASSRLS para que los superadmins también queden trace-eados sin colisión RLS).

**Gaps**:
- 🟡 Modelo `User.tenant_id` migró a NULLABLE para superadmin (M2 audit). El sentinel original `"GLOBAL"` quedó eliminado. Documentado en ADR-0004.
- 🟡 No hay BAC fine-grained (ABAC) — todo es role-based. Aceptable MVP. Si fase 2 introduce delegated admin (por ejemplo, "supervisor de batch X pero no de Y"), requiere modelo `Permission` + `attribute`-based.
- 🟡 IDOR explícito por path param: confiamos en RLS. Si una migración futura desactiva RLS por error, IDOR sería el primer síntoma. Mitigación: tests cross-tenant en CI ([`test/security/cross-tenant.spec.ts`](../segurasist-api/test/security/cross-tenant.spec.ts)) fallan si RLS se rompe.
- 🟡 Sprint 5 pendiente: pen test externo que ataque RBAC + RLS combinado.

**Evidencia**: `segurasist-api/test/e2e/rbac.e2e-spec.ts`, `segurasist-api/test/security/cross-tenant.spec.ts`, `segurasist-api/src/auth/guards/roles.guard.ts`, `segurasist-api/prisma/rls/policies.sql`, ADR-0004.

---

## A02:2021 — Cryptographic Failures

**Riesgo**: datos personales/PHI en tránsito o reposo sin cifrado; criptografía rota; secretos en repo; tokens predictibles.

**Controles aplicados**:
- ✅ TLS forzado por TLD: `segurasist.app` está en HSTS preload (Google `.app`); navegadores rechazan plaintext sin negociación.
- ✅ Helmet con CSP siempre activa: `default-src 'none'`, `frame-ancestors 'none'`, `connect-src` allowlist.
- ✅ JWTs RS256 firmados por Cognito (cognito-local en dev emite RS256 con JWKS público).
- ✅ Cookies `httpOnly` + `sameSite=strict` + `secure` con allowlist explícita `{production, staging}`.
- ✅ `pino` con scrub recursivo (`scrubSensitiveDeep`, depth 12) elimina email, CURP, RFC, password, headers `authorization` y `cookie` antes de escribir log.
- ✅ Magic bytes validation en uploads (XLSX = ZIP + `xl/workbook.xml`; CSV = ASCII subset). Evita upload disfrazado.
- ✅ Secretos en `.env` local (gitignored); en producción Sprint 5 → AWS Secrets Manager con rotación.
- ✅ Audit log con SHA-256 chain planeado (verify-chain endpoint en Sprint 5; estructura ya soporta `prev_hash`).

**Gaps**:
- 🟡 **At-rest hoy** (Sprint 1–4): Postgres en Docker, sin TDE. LocalStack S3 sin cifrado real. Aceptable en local-first; cierra en Sprint 5 con RDS encrypted (AES-256 KMS) + S3 SSE-KMS por tenant.
- 🟡 Object Lock COMPLIANCE en buckets `audit/certificates/exports` planeado Sprint 5 con retención 730 días. Ver [`INTERIM_RISKS.md`](./INTERIM_RISKS.md) §1.1.
- 🟡 KMS CMK con rotación anual: planeado Terraform Sprint 5. Hoy LocalStack key arbitrario.
- 🟡 Hash chain del audit log (verify-chain) hoy sólo es estructura; el endpoint y el cron de verificación llegan en Sprint 5.
- 🟡 Cifrado en tránsito interno (App Runner → RDS) usa TLS por default de RDS — ya queda forzado vía parámetro `rds.force_ssl=1` en Sprint 5.

**Evidencia**: `segurasist-api/src/main.ts` (helmet config), `segurasist-api/src/common/logger/scrub-sensitive.ts`, `segurasist-web/apps/admin/middleware.ts`, `segurasist-api/test/unit/scrub-sensitive.spec.ts`.

---

## A03:2021 — Injection

**Riesgo**: SQL injection, command injection, LDAP injection, NoSQL injection, XSS server-rendered.

**Controles aplicados**:
- ✅ **SQL**: Prisma como ORM con queries parametrizadas. Cualquier `$queryRaw` requiere uso de template literal con interpolación segura (`Prisma.sql\`...${param}\``). Code review obliga a justificar cualquier `$queryRawUnsafe`.
- ✅ DTO validation con `class-validator` + `class-transformer` global pipe (`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`). Cualquier propiedad fuera del DTO se descarta.
- ✅ XSS server-side: respuestas API son JSON; Next.js auto-escape de JSX en server components y client components. El único `dangerouslySetInnerHTML` (theme anti-FOUC) está comentado y revisado (audit L2).
- ✅ XSS via uploads: validación magic bytes + parser `exceljs` que NO ejecuta macros + storage en bucket separado con `Content-Disposition: attachment` cuando el certificado se sirve.
- ✅ Logs scrub recursivo evita que payloads de inyección queden visibles en CloudWatch (post Sprint 5).
- ✅ Helmet CSP `default-src 'none'` mitiga XSS reflejado si llegara a colarse.

**Gaps**:
- 🟡 No hay WAF aún (Sprint 5 → AWS WAF Managed Rules: `CommonRuleSet`, `KnownBadInputs`, `SQLi`).
- 🟡 No hay test fuzz dedicado contra DTO validation. Recomendación Sprint 5: integrar `restler-fuzzer` o similar en CI.
- 🟡 No usamos LDAP / NoSQL — N/A para esos vectores.
- 🟡 `exceljs` parser: revisado contra CVE histórico, no hay XXE en la versión actual. Verificar en cada bump.

**Evidencia**: `segurasist-api/src/main.ts` (ValidationPipe global), `segurasist-api/src/batches/batches.service.ts` (parser exceljs), `segurasist-api/src/common/upload/file-magic-bytes.ts`, audit L2 en PROGRESS.md Día 4.

---

## A04:2021 — Insecure Design

**Riesgo**: ausencia de threat modeling, controles compensatorios mal pensados, secure-by-default ausente.

**Controles aplicados**:
- ✅ **Threat model implícito documentado en ADRs**:
  - ADR-0002 (audit log persistence): por qué BYPASSRLS, fire-and-forget, retención.
  - ADR-0003 (RBAC roles-only MVP): por qué scopes diferidos a fase 2.
  - ADR-0004 (superadmin nullable tenant + bypass RLS): cómo gestionamos el tenant cero sin colisión de RLS.
  - ADR-012 (cross-region DR us-east-1).
  - ADR-014 (región primaria mx-central-1 — residencia de datos).
- ✅ **Multi-tenant isolation by design**: RLS no es post-hoc, es la primera migración. La política está separada de la migración de schema (`prisma/rls/policies.sql`) precisamente para que cualquier nueva tabla con `tenant_id` requiera política explícita.
- ✅ **Defense in depth**: RBAC (NestJS Guard) + RLS (PostgreSQL) + pool aud claim (JWT layer) + middleware Next.js redirect. Tres capas independientes; el bypass requiere romper las tres.
- ✅ **Rate limiting + audit log + scrub recursivo + magic bytes + Origin allowlist + helmet CSP** aplicados en bloque (audit Sprint 1 día 4) en lugar de "lo añadimos después".
- ✅ **Secure by default**: `forbidNonWhitelisted: true` en DTOs, `httpOnly + sameSite=strict` en cookies, helmet siempre activo, `default-src 'none'` en CSP.
- ✅ **Local-first stack** (`docker-compose`) reduce drift entre dev y prod en el modelo de seguridad: el RBAC y RLS son los mismos contra cognito-local + Postgres real que contra Cognito + RDS reales.
- ✅ Tests negativos representan ~40% del suite (no-auth, wrong role, wrong tenant, magic-bytes mismatch).

**Gaps**:
- 🟡 No hay STRIDE formal documentado. Recomendación Sprint 5 pre-pentest: producir un threat model STRIDE explícito como input al pen test.
- 🟡 No hay abuse stories en backlog. El proceso captura user stories pero no "abuse stories" (qué intenta el atacante).
- 🟡 Endpoint ARCO (Sprint 4): tendrá que diseñarse con OTP rate-limited y prueba de identidad — no es trivial. Ya señalado en LEG-001.
- 🟡 Chatbot Sprint 4: el design actual asume que el prompt nunca contiene PHI. Necesita threat model dedicado (prompt injection, exfiltración por respuesta, jailbreak con datos del catálogo).

**Evidencia**: `segurasist-api/docs/adr/`, `segurasist-infra/docs/adr/`, PROGRESS.md "Decisiones técnicas vivas".

---

## A05:2021 — Security Misconfiguration

**Riesgo**: defaults inseguros, headers faltantes, debug en prod, CORS abierto, mensajes de error con stack trace.

**Controles aplicados**:
- ✅ Helmet con CSP siempre activa (no condicional a `NODE_ENV`). `frame-ancestors 'none'`, `default-src 'none'`, `connect-src` allowlist.
- ✅ CORS estricto: `CORS_ALLOWED_ORIGINS` whitelist (sin wildcard). En dev: `localhost:3001,localhost:3002`. Producción Sprint 5: subdominios `segurasist.app` explícitos.
- ✅ Origin allowlist en `local-login` route handler + middleware admin: doble guarda contra CSRF cross-site.
- ✅ `COGNITO_ENDPOINT` valida regex AWS en producción (anti-footgun: si alguien por error setea `COGNITO_ENDPOINT=http://internal-test` en prod, el guard lo rechaza al boot).
- ✅ HttpExceptionFilter preserva status original (503/415/etc.) — no enmascara con 500 genérico ni filtra mensaje del exception en payload.
- ✅ pino-pretty en dev, JSON en prod. `LOG_LEVEL` controlable; default `info` en prod, `debug` en dev.
- ✅ env schema validation (`@nestjs/config` + Joi/Zod) al boot: variables faltantes o inválidas → no arranca.
- ✅ Cookie `secure` con allowlist explícita `{production, staging}` (no `!== 'development'` que es propenso a typos).
- ✅ Tests verifican headers de seguridad en suite de integración (`security-headers integration` en e2e BE).

**Gaps**:
- 🟡 No hay CIS Benchmark scan automático sobre la cuenta AWS. Sprint 5 → Security Hub con CIS AWS Foundations Benchmark v2.0 (ver AWS-001 §6).
- 🟡 No hay scanner de configuración de Postgres (`pg_partman`, parámetros). Sprint 5 → RDS parameter group endurecido.
- 🟡 LocalStack hoy no aplica políticas reales de S3 (Block Public Access, encryption); es simulación. Sprint 5 → SCP a nivel Organization que bloquea creación de buckets sin BPA + encryption (ver AWS-001 §5).
- 🟡 No hay Terraform plan/apply en CI todavía (GH-002 pendiente). Sprint 5 → drift detection diaria.

**Evidencia**: `segurasist-api/src/main.ts`, `segurasist-api/src/common/config/env.schema.ts`, `segurasist-api/src/common/filters/http-exception.filter.ts`, `segurasist-web/apps/admin/middleware.ts`.

---

## A06:2021 — Vulnerable and Outdated Components

**Riesgo**: dependencias con CVE no parcheado; transitivas opacas; no hay proceso de bump.

**Controles aplicados**:
- ✅ `package-lock.json` y `pnpm-lock.yaml` versionados. Builds reproducibles.
- ✅ CI corre `npm audit --omit=dev` y `pnpm audit` (en `.github/workflows/ci.yml`, ejecutará al desbloquear GH-001).
- ✅ Renovate / Dependabot: planeado al activar GitHub repo (GH-001). Bump semanal con auto-merge para patch en deps no críticas, PR manual para minor/major.
- ✅ Lockfile maintenance: jobs separados para `npm` (api) y `pnpm` (web).
- ✅ GitHub Advanced Security (Secret Scanning + Dependabot alerts + CodeQL) cuando GH-001 desbloquee.
- ✅ Imágenes Docker base con tag explícito (`postgres:16-alpine`, `redis:7-alpine`) — no `latest`. Bump explícito en PR.
- ✅ Lista de dependencias de runtime acotada y revisada: NestJS 10, Fastify, Prisma, exceljs, pino, helmet, class-validator. Sin paquetes "abandonware".

**Gaps**:
- 🟡 No hay SBOM (Software Bill of Materials) automatizado todavía. Sprint 5 → `cyclonedx-npm` y `cyclonedx-bom` en CI, archivar SBOM por release.
- 🟡 No hay container image scanning (Trivy, ECR scan). Sprint 5 → ECR con scan-on-push + Trivy en CI.
- 🟡 No hay license scanning. Sprint 5 → `license-checker` en CI; whitelist explícita.
- 🟡 Anthropic SDK (Sprint 4) será nueva dependencia con superficie crítica — bump policy estricta.

**Evidencia**: `.github/workflows/ci.yml`, `segurasist-api/package-lock.json`, `segurasist-web/pnpm-lock.yaml`.

---

## A07:2021 — Identification and Authentication Failures

**Riesgo**: enumeración de usuarios, brute force sin rate limit, sesiones débiles, MFA opcional, recuperación de contraseña insegura.

**Controles aplicados**:
- ✅ Cognito User Pools como IdP — implementación auditada por AWS (no rolled-our-own).
- ✅ Rate limit endpoint `/v1/auth/*`: 5 req/min por IP (vs 60/min default). Backed por Redis (`@nestjs/throttler` con `ThrottlerStorageRedisService`).
- ✅ Pool isolation: admin pool vs insured pool. Un JWT del pool insured no abre nada de admin (validación `aud + token_use` en `JwtAuthGuard`).
- ✅ Refresh token rotation: `RevokeTokenCommand` invalida la familia completa al detectar reuso (Cognito built-in).
- ✅ Cookies httpOnly: el JWT nunca llega a `localStorage` ni a JS del browser.
- ✅ Login admin (S1-01): respuesta uniforme para credenciales inválidas vs usuario inexistente (sin user enumeration). Verificado en `auth.e2e-spec.ts`.
- ✅ `GlobalSignOut` disponible vía endpoint admin para revocar todas las sesiones de un usuario tras incidente (ver `IRP.md` §3.3).
- ✅ Audit log registra cada login exitoso/fallido con IP + user agent (en `metadata` jsonb).

**Gaps**:
- 🟡 **MFA**: hoy opcional. Producción (Sprint 5+) → MFA obligatorio para `admin_segurasist` y `admin_mac` (Cognito MFA TOTP). SAML Azure AD MAC (MAC-001) lo cubre via la política de MAC. Plan B (Cognito local MFA) ya documentado en MAC-001.
- 🟡 SAML Federation con Azure AD MAC pendiente (MAC-001). Plan B Cognito local con MFA TOTP ya operativo.
- 🟡 Portal asegurado (Sprint 3): autenticación por OTP via email (sin password). Diseño pendiente del rate limit fino (5 OTP / 15min / contacto) y throttle de reenvío.
- 🟡 Recuperación de contraseña admin: hoy sólo via Cognito ForgotPassword default. Sprint 5 → custom email template + DKIM-signed.
- 🟡 No hay dispositivo trusted / device fingerprint todavía. Backlog post Go-Live.

**Evidencia**: `segurasist-api/src/auth/cognito.service.ts`, `segurasist-api/src/auth/guards/jwt-auth.guard.ts`, `segurasist-api/src/throttler/`, `segurasist-api/test/e2e/auth.e2e-spec.ts`.

---

## A08:2021 — Software and Data Integrity Failures

**Riesgo**: deploy sin firma, deserialización insegura, dependencias resueltas desde fuentes no confiables, audit log mutable.

**Controles aplicados**:
- ✅ Builds reproducibles vía lockfiles versionados.
- ✅ CI corre tests, lint y typecheck antes de generar artifact (`.github/workflows/ci.yml` — desbloquea con GH-001).
- ✅ `ci-success` aggregate gate: ningún PR mergea sin todos los checks verdes.
- ✅ Branch protection en `main` (planeado GH-001): require PR + 1 approval + ci-success + signed commits (recomendado).
- ✅ Secret scanning en CI vía GitHub Advanced Security (GH-001).
- ✅ Magic bytes validation en uploads — bloquea archivos disfrazados (XLSX que en realidad son scripts).
- ✅ JSON parsing strict: `class-validator` rechaza propiedades extra (`forbidNonWhitelisted: true`).
- ✅ Audit log persistido (M2 audit) con BYPASSRLS dedicado para que el insert no choque con RLS de la operación.

**Gaps**:
- 🔴 **Audit log mutable hoy**: documentado en `INTERIM_RISKS.md` §1.2. Cierre Sprint 5 con S3 Object Lock COMPLIANCE 730 días + hash chain SHA-256 verificable + replicación cross-region.
- 🟡 Buckets `audit/certificates/exports` mutables hoy (LocalStack). Object Lock COMPLIANCE planeado Sprint 5.
- 🟡 No hay artifact signing (cosign) ni provenance (SLSA). Sprint 5 → cosign sign en CI + verify en deploy.
- 🟡 No hay integrity check periódico de la cadena del audit log. Sprint 5 → endpoint `verify-chain` + cron diario que alarma si rompe.
- 🟡 OIDC GitHub Actions → AWS pendiente (GH-002). Hasta entonces, deploy es manual desde laptop del DevOps.
- 🟡 Imágenes Docker: pin por tag, no por digest. Mejora menor — bumpar a `image:tag@sha256:...` en Sprint 5.

**Evidencia**: `.github/workflows/ci.yml`, `segurasist-api/src/common/upload/file-magic-bytes.ts`, ADR-0002, `INTERIM_RISKS.md` §1.2.

---

## A09:2021 — Security Logging and Monitoring Failures

**Riesgo**: incidentes pasan inadvertidos por días/meses; logs no protegidos contra tampering; falta correlación.

**Controles aplicados**:
- ✅ Audit interceptor global registra cada operación mutativa: `actor_id`, `tenant_id`, `action`, `resource_type`, `resource_id`, `metadata jsonb` (incluye IP + UA), `created_at`.
- ✅ pino structured logging con scrub recursivo (M5): nada de PII/credenciales en logs aplicacionales.
- ✅ HttpExceptionFilter preserva status original — no enmascara errores como 500 (que ocultarían señales).
- ✅ Tests automatizados sobre el audit interceptor (verifica que las mutaciones generan entrada).
- ✅ Logs separados por componente: `docker logs api`, `docker logs postgres`, etc. (pre Sprint 5). Sprint 5 → CloudWatch log groups por servicio con KMS y retention.
- ✅ IRP §3.4 documenta cómo recolectar y preservar logs en cadena de custodia ante incidente.

**Gaps**:
- 🟡 **Alerting**: no existe todavía. Sprint 5 → CloudWatch alarms + GuardDuty + SNS → PagerDuty (OPS-002).
- 🟡 **SIEM / agregación**: no existe. Sprint 5 → Security Hub agregando GuardDuty + Config + Inspector + CloudTrail desde la cuenta `security` (AWS-001 §6).
- 🟡 **Retention policy**: hoy `docker logs` con rotación default. Sprint 5 → CloudWatch 90 días operacional + 365 días auth/audit, todos cifrados con KMS.
- 🟡 **Tampering protection del audit log**: documentado como riesgo en `INTERIM_RISKS.md` §1.2. Cierre Sprint 5 con hash chain + Object Lock.
- 🟡 **APM / RUM**: pendiente (Sentry o Datadog en `SUB_PROCESSORS.md` §2.2).
- 🟡 **Status page pública**: `status.segurasist.app` planeado con UptimeRobot (OPS-003).
- 🟡 **On-call rotation**: PagerDuty Free Tier inicial (OPS-002).
- 🟡 No hay drill que mida MTTD/MTTR todavía. IRP §6 calendariza tabletop trimestral.

**Evidencia**: `segurasist-api/src/common/interceptors/audit.interceptor.ts`, `segurasist-api/src/common/logger/scrub-sensitive.ts`, `INTERIM_RISKS.md`, `IRP.md`.

---

## A10:2021 — Server-Side Request Forgery

**Riesgo**: la API hace requests outbound a URLs controladas por el atacante; metadata service AWS expuesto; bypass de firewalls internos.

**Controles aplicados**:
- ✅ **Superficie SSRF reducida por design**: la API no acepta URLs arbitrarias del usuario. Los únicos outbound son a destinos hardcoded:
  - Cognito (`COGNITO_ENDPOINT` validado contra regex AWS en prod).
  - SES (vía SDK — endpoint regional fijo).
  - S3 (vía SDK).
  - Postgres (vía Prisma — connection string fija).
  - Anthropic API (Sprint 4 — endpoint `https://api.anthropic.com` hardcoded en SDK).
- ✅ **`COGNITO_ENDPOINT` regex guard** (M4 audit): en `production` rechaza cualquier valor que no haga match con el patrón AWS. Cualquier intento de redirigir a metadata service interno (169.254.169.254) o a un endpoint atacante falla al boot.
- ✅ Outbound desde App Runner / ECS Fargate post Sprint 5 saldrá vía VPC NAT a destinos controlados por SG egress rules.
- ✅ Imágenes externas: el portal no embebe imágenes de terceros (los avatares son iniciales generadas en client). CSP `img-src 'self' data:` cierra el vector.

**Gaps**:
- 🟡 Webhooks o callbacks de terceros: no hay todavía. Si Sprint 4+ introduce webhooks desde Stripe/Conekta o desde MAC, requiere allowlist explícita y validación HMAC.
- 🟡 No hay control de egress en stack local. Mitigación: el alcance del stack local es la laptop del dev, blast radius reducido.
- 🟡 Sprint 5: instalar IMDSv2 obligatorio en EC2/ECS metadata + SCP que niegue requests al metadata service desde Lambda salvo casos justificados.
- 🟡 No hay test de SSRF en suite. Recomendación Sprint 5 pre-pentest: añadir caso negativo "qué pasa si COGNITO_ENDPOINT apunta a 169.254.169.254" — debe fallar al boot por regex.

**Evidencia**: `segurasist-api/src/common/config/env.schema.ts` (regex AWS para COGNITO_ENDPOINT), `segurasist-api/src/auth/guards/jwt-auth.guard.ts`, audit M4.

---

## Resumen ejecutivo

### Postura por categoría

| Categoría | Cobertura | Gaps relevantes | Cierre planeado |
|---|---|---|---|
| A01 Broken Access Control | ✅ Fuerte | — | Pen test Sprint 5 |
| A02 Cryptographic Failures | 🟡 Parcial | At-rest sin TDE / KMS hoy; Object Lock pendiente | Sprint 5 |
| A03 Injection | ✅ Fuerte | WAF pendiente | Sprint 5 |
| A04 Insecure Design | 🟡 Parcial | STRIDE formal no documentado | Sprint 5 pre-pentest |
| A05 Security Misconfiguration | ✅ Fuerte | CIS Benchmark scan pendiente | Sprint 5 |
| A06 Vulnerable Components | 🟡 Parcial | SBOM/container scan pendientes | Sprint 5 |
| A07 Auth Failures | 🟡 Parcial | MFA obligatorio + SAML real pendientes | Sprint 5 + MAC-001 |
| A08 Software/Data Integrity | 🔴 Gap real (audit mutable) | Object Lock pendiente | Sprint 5 |
| A09 Logging/Monitoring | 🟡 Parcial | Sin alerting/SIEM/retention enforcement | Sprint 5 + OPS-002/003 |
| A10 SSRF | ✅ Fuerte (superficie reducida) | IMDSv2 / SCPs pendientes | Sprint 5 |

### Lectura honesta

- **Lo más fuerte hoy**: A01 (RBAC + RLS con tests reales en SQL), A03 (Prisma + DTO whitelisting + magic bytes), A05 (helmet/CSP/CORS/cookie defaults), A10 (superficie outbound minúscula).
- **Lo más débil hoy**: A08 — el audit log es mutable hasta que Sprint 5 cierre Object Lock COMPLIANCE. Ese es el único gap rojo del set y está documentado tanto aquí como en `INTERIM_RISKS.md` §1.2 con su mitigación interim (snapshots cifrados ante hallazgo).
- **Lo que un security questionnaire enterprise va a marcar pre Sprint 5**: ausencia de SOC 2 / ISO 27001 propio (somos vendor pre-revenue), ausencia de pen test reciente, ausencia de bug bounty público. Honestamente: ninguno de esos es alcanzable en MVP — son post Go-Live.

### Próxima auditoría

- Sprint 5 — pre-pentest: actualizar este doc con threat model STRIDE explícito, cerrar A02/A06/A08/A09 con la infraestructura AWS real y volver a pasar el self-assessment.
- Anual recurrente — post pen test externo: cada hallazgo se mapea a una categoría y se actualiza la columna "Gaps".
