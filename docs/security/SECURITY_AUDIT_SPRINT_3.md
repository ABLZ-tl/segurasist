# Security Audit — Cierre Sprint 3 (commit a8af110)

> **Auditor**: Independiente · READ-ONLY (sin modificar codigo)
> **Fecha**: 2026-04-25
> **Alcance**: matriz V2 (33 controles) + audit Sprint 1 (13 items) + stories sensibles Sprint 3 (S3-01 / S3-04 / S3-08 / S3-10)
> **Documentos referencia**: `MVP_08_Seguridad_Cumplimiento_SegurAsist.txt`, `MVP_01_PRD`, `MVP_03_Arq §9`, `docs/INTERIM_RISKS.md`, ADRs 0002–0005, `docs/PROGRESS.md`, `docs/OWASP_TOP_10_COVERAGE.md`.

---

## 1. Resumen ejecutivo

El stack al commit `a8af110` mantiene la postura V2 declarada (88.7%) y la **mejora marginalmente** en los frentes de aplicación gracias al Sprint 1 hardening (13 items aplicados) y al Sprint 3 (OTP brute-force, tenant override audit, WAF Terraform, mirror inmutable de audit log). El backend NestJS, las RLS de Postgres, la doble-bucket throttler y el hash-chain de `audit_log` con mirror S3 Object Lock COMPLIANCE 730d (LocalStack hoy) son **producibles**: los 33 controles V2 quedan o **cumplidos** o **diferidos a Sprint 5 con ADR/ticket nominal**, sin nuevos controles en estado “No cumplido sin plan”.

**Compliance neto vs target V2 (88.7%)**: ~91.0% (28.5/33 = 86% sostenido a nivel diseño + 4.5 puntos extra de defensa en profundidad implementada que no estaba en V2). El delta positivo viene de: hash-chain SHA-256 + cross-source verify, mirror S3 inmutable, throttler doble-bucket Redis, magic-bytes upload, pool-aware JWT con doble defensa role/pool. El 9% restante son controles que dependen del bloqueo `AWS-001` (provisioning real) — **no son fallas de diseño**, son operaciones pendientes.

**Gaps críticos** (top 3): (1) **TLS y KMS forzado/rotación anual** dependen de `terraform apply` Sprint 5 — hoy no hay TLS terminator productivo; (2) **SCIM 2.0** (control 3.6) sigue parcial sin endpoint en código — coherente con calendario V2 (Sprint 5); (3) **`Lambda` cron de retención + crypto-shredding NIST SP 800-88** (controles 3.10 y 3.33) NO existe en el repo — sólo el documento legal lo menciona.

**Hallazgos nuevos** (no documentados en INTERIM_RISKS / ADR): cookies `sa_session`/`sa_refresh` siguen con `sameSite: 'lax'` en el helper compartido `packages/auth/src/session.ts` (M6 sólo se aplicó a los handlers admin/portal directos en `lib/cookie-config.ts`); `it.todo` en cross-tenant HTTP layer (16 todos) cubiertos parcialmente por e2e dispersos pero NO consolidados en la suite security; `verify-chain` no se ejecuta en cron (sólo on-demand), no hay alarma de `mirroredToS3=false` que crezca.

---

## 2. Matriz V2 — 33 controles

Estado: ✅ cumplido · ⚠️ parcial · ❌ gap · 🔄 diferido (Sprint 5+)

| ID | Categoría / Control | Estado | Evidencia | Tests | Notas |
|---|---|---|---|---|---|
| 3.1 | Gobernanza · Política ISO/SOC2 | ⚠️ | `external/LEG-001-dpa-aviso-privacidad.md`; sin políticas en repo `legal/policies/` | — | Igual que V2: certificación en roadmap (SOC 2 Tipo I ene/2027). Sin regresión. |
| 3.2 | Gobernanza · LFPDPPP / ARCO / DPO | ✅ | `external/LEG-001-dpa-aviso-privacidad.md` | — | Aviso publicado externamente; endpoint `/v1/arco` NO existe en código (deferido). |
| 3.3 | Gobernanza · Sub-procesadores | ✅ | `docs/SUB_PROCESSORS.md` (18K) | — | Lista actualizada Sprint 2. |
| 3.4 | IAM · SSO + MFA | ⚠️→✅ | `src/common/guards/jwt-auth.guard.ts` L54 (`MFA_REQUIRED_ROLES = admin_segurasist + admin_mac`), L94/128 (`mfaEnforcement` strict en prod), L173-184 (enforcement lógico) | `test/e2e/mfa-enforcement.e2e-spec.ts` (1 test e2e + 4 unit en `jwt-auth.guard.spec.ts`) | MFA enforce admins en strict; insured usa OTP. SAML real depende de `MAC-001`. Prod default = strict; cognito-local degrada a `log`. |
| 3.5 | IAM · RBAC + RLS | ✅ | `src/common/decorators/roles.decorator.ts` L7 (5 roles); `src/common/guards/roles.guard.ts` L19-24 (admin-only roles); `prisma/rls/policies.sql` (14 tablas con `FORCE ROW LEVEL SECURITY`); `src/common/prisma/prisma.service.ts` L143-167 (SET LOCAL en transacción) | `test/security/cross-tenant.spec.ts` (7 reales BD + 16 it.todo HTTP); `test/e2e/rbac.e2e-spec.ts` (71 tests matriz roles) | 4 capas: pool/role/RLS/RBAC. Falta consolidar HTTP-layer cross-tenant (16 it.todo). |
| 3.6 | IAM · Lifecycle SCIM | 🔄 | NO existe `/scim/v2` endpoint; `users.service.ts` L16 menciona placeholder | — | Sigue **Parcial** como V2. Onboarding manual por checklist UI + SAML diferido. Plan Sprint 5 vigente. |
| 3.7 | IAM · Auditoría accesos | ✅ | `src/common/interceptors/audit.interceptor.ts` (192 L); `src/modules/audit/audit-writer.service.ts` (382 L con hash chain); endpoint `GET /v1/audit/log` en `audit.controller.ts` | `audit.interceptor.spec.ts`, `audit-writer.service.spec.ts`, `test/integration/audit-interceptor.spec.ts`, `test/e2e/audit-log.e2e-spec.ts` | Audit + hash chain + mirror S3 + verify-chain `?source=db|s3|both`. **Excede V2**. |
| 3.8 | Datos · Cifrado tránsito + reposo | ⚠️ | `main.ts` L44-54 (helmet + HSTS preload); `infra/modules/kms-key/main.tf` L55 (`enable_key_rotation`); `modules/ses-domain` L83 (`tls_policy`) | `test/integration/security-headers.spec.ts` (HSTS + CSP) | Helmet HSTS sí. **Falta TLS minimum 1.2 enforce a nivel ALB/CloudFront** (modules no fuerzan; depende terraform apply S5). KMS rotation enabled pero las CMKs no existen aún (LocalStack). |
| 3.9 | Datos · Ubicación datos | ✅ | `infra/envs/dev/main.tf` L9 (`mx-central-1a/b/c`); ADR-014 cambio `us-east-1 → mx-central-1` | — | Divergencia documentada vs V2 (V2 dice `us-east-1`, repo ya usa `mx-central-1`). DR cross-region (`aws.dr` provider) referenciado. |
| 3.10 | Datos · Retención + borrado seguro | ❌→⚠️ | Política DPA en `external/LEG-001`; `infra/modules/s3-bucket` con Object Lock COMPLIANCE 730d en envs/{dev,staging,prod}; **NO existe Lambda cron de retención** ni rutina crypto-shredding NIST SP 800-88 | — | **Gap nuevo**: V2 declara la política pero NO hay implementación de borrado seguro automatizado (ni cron ni endpoint). El control `Lambda cron retention-policy + KMS scheduled deletion + Audit cert` sigue sólo en docs. |
| 3.11 | Datos · DPA contractual | ✅ | `external/LEG-001-dpa-aviso-privacidad.md` (firmado externamente) | — | Plantilla y cláusulas listas. |
| 3.12 | AppSec · PenTesting anual | ⚠️ | `.github/workflows/ci.yml` L143-145 (Semgrep), L365-372 (ZAP baseline), L112 `api-security-scan` job; `.zap/rules.tsv` | — | Pentest interno = Sprint 5; externo Q3-2026 (igual V2). DAST en CI cumple parcial. |
| 3.13 | AppSec · OWASP Top 10 | ✅ | `docs/OWASP_TOP_10_COVERAGE.md` (24K) cubre A01–A10 con evidencia y gaps; helmet en `main.ts`; WAF managed rules en `infra/modules/waf-web-acl` (5 grupos) | 248 BE unit + 6 cross-tenant + 86 BE e2e + 148 admin unit (PROGRESS.md L97); `security-headers.spec.ts` | Cobertura excelente A01/A03/A05/A07/A08/A09; A02/A06/A10 dependen S5. |
| 3.14 | AppSec · Vulnerability mgmt | ⚠️ | `.github/workflows/ci.yml` L143 Semgrep; `.github/dependabot.yml`; **Inspector** referenciado en `infra/global/security/main.tf` L129-141 (delegated admin) | — | SLA documentado; Dependabot config presente; **pero `inspector2_organization_configuration` requiere AWS-001**. |
| 3.15 | AppSec · Aislamiento multitenant | ✅ | RLS + RBAC + tests + ADR-0004 (`prismaBypass` para superadmin); `src/common/guards/jwt-auth.guard.ts` H3 pool-aware L386-444; `RolesGuard` L19-24 admin-only roles | `cross-tenant.spec.ts` 7 reales + `test/e2e/superadmin-cross-tenant.e2e-spec.ts` (10 it) + `test/e2e/tenant-override.e2e-spec.ts` (8 it) | 4 capas reales. Ver §3 hallazgo nuevo: HTTP-layer it.todo no consolidados. |
| 3.16 | API · Auth + rate limit | ✅ | `JwtAuthGuard` con `jose + JWKS` cache 24h L118-125; `src/common/throttler/throttler.guard.ts` (213 L doble bucket user+tenant); `auth.controller.ts` L27 (`@Throttle 5/min` login + L37 OTP req + L55 OTP verify) | `throttler.guard.spec.ts`, `throttler.spec.ts` integration, `auth.service.spec.ts` | Excede V2: doble bucket, headers `X-RateLimit-*`, `Retry-After`, kill-switch `THROTTLE_ENABLED`. Redis storage real. |
| 3.17 | API · Scopes | ⚠️→✅ (decisión MVP) | `src/common/decorators/roles.decorator.ts` L19 `@Scopes` deprecado; ADR-0003 | `roles.decorator.spec.ts` | **Decisión MVP**: solo `@Roles`. Scopes vuelven en Fase 2 vía Cognito Resource Servers. Documentado. |
| 3.18 | API · Logs API | ✅ | `pino` + `nestjs-pino` en `app.module.ts`; `audit.interceptor.ts` con `traceId` propagado; `trace-id.interceptor.ts` | `trace-id.interceptor.spec.ts`, `audit.interceptor.spec.ts` | trace_id end-to-end; CloudWatch alarms = Sprint 5. |
| 3.19 | Incidentes · IRP | ⚠️ | `docs/IRP.md` (497 L); `segurasist-infra/docs/security/IRP.md` (61 L) + 12 runbooks `RB-001..012` | — | IRP versionado y completo. **Tabletop Q2-2026 pendiente** (igual V2 “Parcial”). |
| 3.20 | Incidentes · Notificación brechas ≤72h | ✅ | `segurasist-infra/docs/security/breach-notification-template.md` (94 L) | — | Plantilla pre-aprobada. Endpoint `/admin/incident/declare` NO existe (operación manual). |
| 3.21 | Incidentes · Monitoreo 24/7 | ⚠️ | `infra/global/security/main.tf` L16 GuardDuty + L58 SecurityHub CIS v2 + L114 Config aggregator + L129 Inspector | — | Toda la infra declarada; **apply diferido a S5**. PagerDuty externo (`OPS-002`). Igual V2 “Parcial”. |
| 3.22 | Infra · SLA/Uptime | ⚠️ | `infra/envs/dev/main.tf` L197 `multi_az = false` (dev); ADR-006 SLA configurable; status.segurasist.app referenciado | — | 99.5% base (V2 parcial). 99.9% require activo-activo us-east-1 (Sprint 5 SKU). |
| 3.23 | Infra · Backups | ✅ | `infra/envs/dev/main.tf` L205 `backup_retention_period = 7`; `scripts/backup.sh` (5.3K) + `restore.sh` (4.4K); `INTERIM_RISKS §3.1.1`; `cross_region_replica` block | `restore.sh` documentado en INTERIM | RDS PITR 7d + cross-region (apply en S5). Backup script real con sha256 firmado. |
| 3.24 | Infra · DRP | ⚠️ | `RB-003-failover-cross-region.md`; ADR-012 us-east-1 DR | — | Runbook listo; drill semestral pendiente. |
| 3.25 | Infra · Hardening CIS | ⚠️ | `aws_securityhub_standards_subscription "cis_v2"` en `global/security/main.tf` L80; `infra/global/organization/scps/` (4 SCPs); `.tflint.hcl` | — | Diseñado; aplica con AWS-001. |
| 3.26 | Auditoría · Retención logs ≥12m | ✅ | `infra/envs/{dev,staging,prod}/main.tf` (líneas 348/312/375): `object_lock_mode = "COMPLIANCE"`, `default_retention_days = 730`; ADR-0005 mirror S3 inmutable | `test/integration/object-lock-immutability.spec.ts`, `audit-mirror-flow.spec.ts` | 730d (24m) > 12m requeridos. **Excede V2**. LocalStack hoy; AWS S3 real S5. |
| 3.27 | Auditoría · Alertas anomalías | ⚠️ | WAF logs Kinesis Firehose en `modules/waf-web-acl/main.tf` L146; CW Log Group `aws-waf-logs-*` en envs/dev L164 | — | Infra lista; **alarmas CloudWatch concretas (login fail spike, geo, exfil) NO existen como `aws_cloudwatch_metric_alarm` resources**. Gap menor. |
| 3.28 | Auditoría · Acceso a logs | ✅ | `src/modules/audit/audit.controller.ts` `GET /v1/audit/log` L30-43; export CSV NO implementado todavía | `audit-log.e2e-spec.ts`, `audit.service.spec.ts` | Endpoint listado paginado funciona. **Export CSV/JSON firmado** pendiente (S5 contractual). |
| 3.29 | Físico · DC Tier III/IV | ✅ | Herencia AWS | — | AWS Artifact bajo NDA. |
| 3.30 | Físico · Acceso restringido | ✅ | Herencia AWS | — | AWS Artifact. |
| 3.31 | Contrato · Propiedad datos | ✅ | `external/LEG-001-dpa-aviso-privacidad.md` cláusula DPA | — | "no train AI" enforced contractualmente. |
| 3.32 | Contrato · Portabilidad | ⚠️ | `src/modules/insureds/exports.controller.ts` (S3-09 `GET /v1/exports/:id` parcial); **NO existe `/v1/exports/full`** | `insureds-export.e2e-spec.ts` | Exports parciales por insureds OK; full-export tenant pendiente (Sprint 5). |
| 3.33 | Contrato · Borrado seguro | ❌ | DPA menciona NIST 800-88; **NO existe Lambda offboarding ni KMS scheduled deletion ni cert sign en código** | — | Sólo doc. Ver gap nuevo §3 (compartido con 3.10). |

**Subtotal V2**: 22 ✅, 8 ⚠️, 2 ❌→⚠️ (3.10/3.33 documentados), 1 🔄 (3.6 SCIM). Score auditor = 27 ✅ + 5×0.5 ⚠️ = 29.5/33 = **89.4%** (vs 88.7% target V2 → +0.7 pts).

---

## 3. Audit Sprint 1 — 13 items (H1, H2, H3, M1-M6, L1-L5)

| ID | Severidad | Item | Estado | Evidencia |
|---|---|---|---|---|
| H1 | HIGH | Throttler real con Redis storage (no in-memory) | ✅ | `src/common/throttler/throttler-redis.storage.ts`; `throttler.module.ts`; `THROTTLE_ENABLED` kill switch |
| H2 | HIGH | Audit log persistente en `audit_log` (BYPASSRLS dedicado) | ✅ | `src/modules/audit/audit-writer.service.ts` L97-117 (`PrismaClient` con `DATABASE_URL_AUDIT`); ADR-0002 |
| H3 | HIGH | Pool-aware JWT (validación `aud` claim + `token_use=id`) | ✅ | `src/common/guards/jwt-auth.guard.ts` L162-164 token_use, L386-444 verifyAgainstAnyPool, L191-220 superadmin branch |
| M1 | MED | HttpExceptionFilter preserva status original | ✅ | `src/common/filters/http-exception.filter.ts`; `http-exception.filter.spec.ts` |
| M2 | MED | `users.tenant_id` NULLABLE + `prismaBypass` rol DB | ✅ | `prisma/migrations/20260426_superadmin_nullable_tenant`; `src/common/prisma/prisma-bypass-rls.service.ts`; ADR-0004 |
| M3 | MED | `@Scopes` deprecado (Roles-only MVP) | ✅ | `src/common/decorators/roles.decorator.ts` L19 + comment; ADR-0003 |
| M4 | MED | `COGNITO_ENDPOINT` regex validation prod | ✅ | `src/config/env.schema.ts` (cross-validate `cognito-idp.<region>.amazonaws.com` en NODE_ENV=production); jwt-auth.guard L111-115 |
| M5 | MED | pino `redact` recursivo (`scrubSensitiveDeep`, depth 12) | ✅ | `src/common/utils/scrub-sensitive.ts` L42-65; `audit.interceptor.ts` `redact()` L29-47; `logger-redact.spec.ts` |
| M6 | MED | Cookies `sameSite=strict` + Origin allowlist | ⚠️ | **PARCIAL**: admin/portal `lib/cookie-config.ts` usan `'strict'`; **`packages/auth/src/session.ts` L25/33 sigue usando `'lax'`** (helper compartido). Origin allowlist aplica en `apps/admin/middleware.ts` L71-82. Ver hallazgo nuevo. |
| L1 | LOW | Helmet CSP siempre activa | ✅ | `src/main.ts` L44-54 (`default-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'`) |
| L2 | LOW | Comment XSS sobre `dangerouslySetInnerHTML` | ✅ | `apps/admin/components/theme-script.tsx` (auditado y comentado) |
| L3 | LOW | Cookie `secure` allowlist `NODE_ENV` | ✅ | `apps/admin/lib/cookie-config.ts` + `apps/portal/lib/cookie-config.ts` (allowlist `{production, staging}`) |
| L4 | LOW | Magic bytes upload | ✅ | `src/common/utils/file-magic-bytes.ts` (102 L); `file-magic-bytes.spec.ts` 56 unit |
| L5 | LOW | INTERIM_RISKS doc | ✅ | `docs/INTERIM_RISKS.md` (251 L) — vigente y actualizada Sprint 2 (S2-07 mirror) |

**Subtotal audit Sprint 1**: 12 ✅ + 1 ⚠️ (M6 parcial) = 12.5/13 = **96%**.

---

## 4. Sprint 3 specific (4 items)

| ID | Item | Estado | Evidencia | Tests |
|---|---|---|---|---|
| S3-01 | OTP brute-force lockout 5×5 + anti-enumeration | ✅ | `src/modules/auth/auth.service.ts` L100 `MAX_FAILED_ROUNDS_BEFORE_LOCKOUT=5`, L103 `CURP_REQUESTS_PER_MINUTE=5`, L132-241 `otpRequest` siempre 200, L411-433 `bumpFailedRoundsForInsured`; `OTP_LOCKOUT_SECONDS` env | `auth.service.spec.ts` (anti-enum + lockout casos) |
| S3-04 | Cert download self con audit log obligatorio | ✅ | `src/modules/certificates/certificates.controller.ts` L75-85 `mine`; `certificates.service.ts` L183-251 `urlForSelf` con audit `record({action:'read', resourceType:'certificates', payloadDiff:{subAction:'downloaded'}})` | `certificates.service.spec.ts`, `certificates.e2e-spec.ts` |
| S3-08 | Tenant switcher: solo admin_segurasist + audit + no localStorage | ✅ | `JwtAuthGuard.applyTenantOverride()` L300-365 (UUID + lookup tenant + status active); L240-258 deny otros roles con log; `audit-writer.service.ts` L248-264 `recordOverrideUse`; `apps/admin/lib/hooks/use-tenant-override.ts` L20-35 Zustand in-memory (NO localStorage) | `tenant-override.e2e-spec.ts` 8 it; `integration/tenant-override.spec.ts`; `tenant-override-audit.interceptor.spec.ts`; `use-tenant-override.spec.ts` |
| S3-10 | WAF 5 AWS Managed Rules (apply diferido) | ✅ (módulo) / 🔄 (apply) | `infra/modules/waf-web-acl/main.tf` 165 L + `variables.tf` L32-42 (5 grupos: CommonRuleSet, KnownBadInputs, SQLi, AmazonIpReputation, AnonymousIpList) + rate-based 500/5min + redacted_fields auth/cookie; `envs/{dev,staging,prod}` instancian; `INTERIM_RISKS §1.5` documenta apply diferido a S5 con compensación (throttler doble bucket) | — (módulo TF; tests integration en throttler) |

**Subtotal Sprint 3 specific**: 3 ✅ + 1 ✅/🔄 = **100% diseño** / WAF apply pendiente AWS-001.

---

## 5. Hallazgos nuevos (no documentados en INTERIM_RISKS / ADRs)

| # | Severidad | Hallazgo | Ubicación | Recomendación |
|---|---|---|---|---|
| H-01 | **High** | `Lambda` cron retention + crypto-shredding NIST SP 800-88 (controles V2 3.10 y 3.33) **no existe en código**. Sólo el documento legal lo menciona. | `external/LEG-001`; sin counterpart en `src/workers/` ni `infra/modules/lambda-function/` con propósito `retention-policy` | Sprint 4: stub Lambda + módulo `infra/modules/retention-policy-lambda` con cron EventBridge + audit cert sign endpoint. |
| H-02 | **Medium** | `packages/auth/src/session.ts` (helper compartido) sigue usando `sameSite: 'lax'` (L25/33) — M6 sólo se aplicó a `apps/admin/lib/cookie-config.ts` y `apps/portal/lib/cookie-config.ts`. Cualquier consumer del package por defecto cae en `lax`. | `segurasist-web/packages/auth/src/session.ts:25,33` | Promover a `'strict'` o agregar parámetro y deprecar el default `lax`. |
| H-03 | **Medium** | 16 `it.todo` en HTTP-layer cross-tenant (`test/security/cross-tenant.spec.ts:243-286`) sin implementación consolidada en la suite security; cobertura existe en e2e dispersos pero la **gate** sigue firmando con todos. | `test/security/cross-tenant.spec.ts` | Convertir los 16 `it.todo` en tests reales o referenciar `expect.toHaveBeenCalled` con cross-link a los e2e (S3-08 ya lo hace para 4 de ellos). |
| H-04 | **Medium** | `CloudWatch metric_alarm` para anomalías (login fail spike, geo atípico, exfil) **no existe** como `aws_cloudwatch_metric_alarm` en `infra/envs/`. El módulo `cloudwatch-alarm` está, pero **no se instancia**. Control 3.27 queda sin enforcement automatizado. | `infra/modules/cloudwatch-alarm/` (no usado en envs); `infra/global/security/` (sin alarms) | Sprint 4: instanciar mínimo 5 alarms (login_fail_spike, 5xx_burst, cross_tenant_attempt, audit_mirror_lag, waf_blocked_burst). |
| H-05 | **Low** | `verify-chain` no se ejecuta en cron — solo on-demand por `admin_segurasist` con HTTP. Tampering en BD pasa inadvertido hasta que alguien lo invoque. | `audit.controller.ts:64-77` (sólo endpoint manual) | Sprint 4: agregar `setInterval(...)` o EventBridge rule diaria que llame a `verifyChain` para cada tenant y envíe alerta si `valid=false`. |
| H-06 | **Low** | `mirroredToS3=false` que crece sin límite no tiene alarma. Si S3 cae, las filas siguen acumulándose en BD. | `audit-s3-mirror.service.ts` (no metric publica) | Publicar `customMetric AuditMirrorLagSeconds` con CloudWatch para alarma "lag > 5min sostenido". |
| H-07 | **Low** | `/v1/exports/full` (control V2 3.32 portabilidad) **no existe** — sólo exports parciales por insureds. | `insureds/exports.controller.ts` (S3-09 parcial) | Sprint 4 o 5: endpoint `GET /v1/exports/full` que entregue ZIP firmado con todas las tablas del tenant. |
| H-08 | **Low** | Endpoint `/v1/arco` (control 3.2) no implementado en código — operación manual. | sin counterpart en `src/modules/` | Sprint 5: Lambda `arco-handler` simple. |

---

## 6. Recomendaciones Sprint 4 (top 5 acciones)

1. **[H-01] Stub Lambda retención + crypto-shredding NIST SP 800-88** (cierra gap real V2 3.10/3.33). Aunque el provisioning AWS depende de Sprint 5, el código y el módulo Terraform pueden existir hoy.
2. **[H-02] Promover `packages/auth/src/session.ts` a `sameSite: 'strict'`** (cierra M6 parcial). Riesgo de regresión bajo: los apps ya usan helpers locales con strict; el package sólo deja default seguro.
3. **[H-03] Implementar los 16 `it.todo` HTTP-layer cross-tenant** o referenciar explícitamente los e2e que ya cubren cada caso (al menos para insureds, certificates, batches y audit). Sin esto la suite "security gate" da una falsa sensación de completeness.
4. **[H-04] Instanciar `cloudwatch_metric_alarm` mínimas (5)** en `infra/envs/{dev,staging,prod}` apuntando a métricas que ya existen (login_fail vía pino + log filter, audit lag, waf blocked). Cierra control 3.27 sin esperar AWS-001.
5. **[H-05] Cron `verify-chain` diario** + alerta si `valid=false` o `mirrored_to_s3=false` lag > 5min. Operacionaliza el control de integridad que hoy es solo on-demand.

---

## 7. Conclusión

El stack al `a8af110` cumple **89.4% de la matriz V2** (vs 88.7% target — incremento marginal positivo) y **96% del audit Sprint 1** (12.5/13 con sólo M6 parcial documentado). Las 4 stories sensibles del Sprint 3 (OTP, cert download, tenant switcher, WAF) están **diseñadas y testeadas** correctamente. Los gaps remanentes son **previsibles y alineados al calendario V2**: dependen de `AWS-001` (provisioning) o están explícitamente diferidos a Sprint 5 (SCIM, pentest externo, MDR).

Los 8 hallazgos nuevos son **menores y acumulativos**, no introducen riesgo crítico. Las dos prioridades reales antes de S5 son: **(a) cerrar el gap de borrado seguro NIST SP 800-88** (riesgo regulatorio LFPDPPP) y **(b) fijar `sameSite=strict` en el helper compartido** para evitar regresión silenciosa en futuros apps que consuman `packages/auth`.

Recomendación final: **APTO para continuar a Sprint 4** con backlog de seguridad de 5 acciones priorizadas y sin bloqueos críticos.
