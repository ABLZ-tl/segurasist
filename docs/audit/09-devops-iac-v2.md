# Audit Report v2 — DevOps + Terraform + IaC + scripts (B9)

> Segunda vuelta. Re-revisión de [09-devops-iac.md](./09-devops-iac.md).
> Cruza con: 02-multitenant-rls (exports table), 03-batches (FIFO/insureds-creation),
> 04-certificates-email (Mailpit, SES tags), 05-insureds-reports (reports-queue FIFO),
> 06-audit-throttler (CW alarms, audit BOX env), 07-frontend-admin (API_BASE_URL),
> 10-tests-dx (CI flat config, Trivy).

## TL;DR (≤10 líneas)

Re-confirmados los **3 Critical** de la 1ra vuelta (A9-01 Swagger, A9-02 tf_plan_{staging,prod}, A9-03 CW alarms). Sumamos **2 Critical nuevos** que la 1ra vuelta no destacó: (a) **`exports` table NO está en `policies.sql`** — re-aplicar `apply-rls.sh` contra DB recién migrada deja `exports` SIN RLS (RBAC depende del WHERE, no de la BD); confirmación cruzada de A2-35 que A9 sólo mencionó tangencial. (b) **`insureds-creation-queue` no se crea en Terraform** y el worker la fabrica con `String.replace` — esto fue High en A9-04, pero re-leído junto con A3-31 (sendMessage rompe en AWS real) y A9-09 (FIFO drift) eleva la prioridad: en **deploy real a mx-central-1, el batch flow falla en cuanto se envía el primer mensaje**. Es un bloqueo Sprint 5, no Sprint 4. Patrón sistémico **SQS standard vs FIFO** (3 áreas: A3, A5, A9), **Env schema drift** (8 vars dead/missing en `.env.example` ↔ `env.schema.ts`), **CI-gate ausente para patrones** (CSRF logout, JwtAuthGuard global, throttler tenant). Trivy job continúa ausente. WAF apply diferido **no tiene fecha** (sólo "Sprint 5"). 9/12 runbooks siguen `> TBD`. Total: 18 findings nuevos (2 Critical, 7 High, 7 Medium, 2 Low).

## Re-confirmación 1ra vuelta

| ID 1ra vuelta | Sev | Estado v2 | Notas |
|---|---|---|---|
| A9-01 Swagger | Critical | **Confirmado** | `grep -rn SwaggerModule src/` → 0 matches. `.env.example:71` tiene `ENABLE_SWAGGER=true` pero `env.schema.ts:126` lo parsea sin uso. CI gate `api-dast` línea 367 fallará. |
| A9-02 tf_plan_{staging,prod} | Critical | **Confirmado** | `iam-github-oidc/main.tf:226-238` sólo tiene `tf_plan_dev`. `terraform-plan.yml:99` dispara matrix sobre `dev/staging/prod`. |
| A9-03 CW alarms | Critical | **Confirmado** | `grep "module \"cloudwatch_\|aws_cloudwatch_metric_alarm" envs/` → 0 matches. Módulo existe (`modules/cloudwatch-alarm/`) pero NUNCA instanciado. RB-001/002/004/005/007/008/010 referencian alarmas inexistentes. |
| A9-04 insureds-creation queue | High → **Critical** | **Promovido** | Re-leído con A3-31 + A9-09: en AWS real el flow batch rompe. |
| A9-05 Trivy | High | **Confirmado** | `grep -rn Trivy .github/` → 0 matches. |
| A9-06 PowerUserAccess/Admin | High | **Confirmado** | Sin cambios. |
| A9-09 SQS FIFO drift | High | **Confirmado + cross-cutting** | A3-31 (insureds-creation) + A5-37 (reports) + A9 → patrón sistémico. |
| A9-10 Runbooks TBD | High | **Confirmado** | RB-001/002/003/004/005/006/007/008/009/010 con `> TBD` (9 de 12). RB-011/012 OK. |

## Findings nuevos (18)

| ID | File:line | Sev | Categoría | Descripción | Recomendación |
|---|---|---|---|---|---|
| **B9-26** | `segurasist-api/prisma/rls/policies.sql:49-64` + `scripts/apply-rls.sh` | **Critical** | Security/RLS | `exports` table NO está en el array `tables` de `policies.sql` (re-confirma A2-35). Re-aplicar `apply-rls.sh` contra DB con `20260427_add_exports_table` aplicado → `exports` queda SIN `ENABLE ROW LEVEL SECURITY`, sin `FORCE ROW LEVEL SECURITY`, sin policies tenant-iso. RLS protección depende del WHERE en `reports.service.ts`, no de la BD. Re-bootstrap con `apply-rls.sh` en CI (línea 238 de ci.yml) podría dejar exports vulnerable según el orden. | Agregar `'exports'` al array de `policies.sql:49-64`. **Verificar también**: cualquier tabla nueva (sprint 4/5) con `tenant_id` debe agregarse al array. Considerar SQL function `__assert_rls_on_all_tenant_tables()` que falle el bootstrap si una tabla con columna `tenant_id` no tiene RLS habilitado. |
| **B9-27** | `segurasist-api/src/workers/insureds-creation-worker.service.ts:63` + `envs/{dev,staging,prod}/main.tf:364-369` + `localstack-bootstrap.sh:138` | **Critical** | Pattern/Bug | El worker hace `env.SQS_QUEUE_LAYOUT.replace('layout-validation-queue', 'insureds-creation-queue')`. **En LocalStack funciona** (la queue se crea en bootstrap). **En AWS real falla** porque (a) Terraform no provisiona `insureds-creation-queue` en `local.queues`, (b) el URL contiene el nombre de cuenta y región mx-central-1 vs LocalStack `000000000000/us-east-1`, (c) la queue derivada por replace probablemente no existe → SQS responde `QueueDoesNotExist`. + drift LocalStack/AWS por A9-09 (FIFO). | Agregar `"insureds-creation" = { vt = 600, retention = 345600 }` al `local.queues` en los 3 envs. Agregar `SQS_QUEUE_INSUREDS_CREATION` al `env.schema.ts`, `.env.example`, `apprunner-service` env_vars. Borrar el `.replace()` del worker. Dejar test E2E que valide queue-existence al boot. **Sprint 4 antes de habilitar OIDC**. |
| **B9-28** | `segurasist-api/.env.example` ↔ `segurasist-api/src/config/env.schema.ts` | High | Drift/DX | **8 variables drift** entre `.env.example` (líneas 1-80) y `env.schema.ts`: <br>– **En schema, NO en .env.example**: `MAILPIT_API_URL` (línea 108, default localhost:8025); `EMAIL_FROM_CERT` (101); `CERT_BASE_URL` (98); `INSURED_DEFAULT_PASSWORD` (154); `OTP_TTL_SECONDS` (161); `OTP_MAX_ATTEMPTS` (164); `OTP_LOCKOUT_SECONDS` (167); `EMAIL_TRANSPORT/SMTP_HOST/SMTP_PORT` (89-91, sólo via local-up.sh).<br>– **En .env.example, dead**: `ENABLE_SWAGGER=true` (71) — `env.schema.ts:126` lo lee pero `main.ts` NO lo usa.<br>– **Ni en .env.example ni en env.schema.ts**: `SQS_QUEUE_INSUREDS_CREATION` (workers la usan via replace).<br>**Cross con A6-48** (`DATABASE_URL_AUDIT` ausente sin alarma).<br>**Cross con A8-51** (`PORTAL_SESSION_COOKIE` no documentado).<br>**Cross con A7-60** (admin `API_BASE_URL` sin doc). | Sprint 4 housekeeping: sincronizar `.env.example` con TODAS las keys de `env.schema.ts`, agregar comentarios indicando default. Borrar `ENABLE_SWAGGER` o wirearlo a `SwaggerModule.setup()`. Agregar test `env-drift.spec.ts` que parse `.env.example` y compare keys vs `EnvSchema.shape`. |
| **B9-29** | `.github/workflows/ci.yml` (entero, 632 líneas) | High | CI/Pattern | NO existe job que detecte los **patrones cross-cutting** reportados por otras áreas:<br>– **A1-21**: `JwtAuthGuard` no registrado como `APP_GUARD` global (verificado: `app.module.ts:119` sólo registra `ThrottlerGuard`).<br>– **A4-25**: webhooks públicos sin throttle (sólo grep manual lo detecta).<br>– **A7-57**: logout por GET sin Origin check (CSRF).<br>– **A6-46**: endpoints sin `@TenantThrottle` cuando deberían.<br>El CI no tiene linter custom ni Semgrep rule para esto. | Agregar Semgrep rules custom en `.semgrep/segurasist.yml`: <br>(a) `@Controller(...)` sin `@UseGuards(JwtAuthGuard)` (a menos que tenga `@Public()`); <br>(b) métodos `@Get/Post('logout')` sin `checkOrigin()` o `@CsrfProtected()`; <br>(c) controllers que escriben PII sin `@TenantThrottle()`. Sumarlo a `api-security-scan` job. |
| **B9-30** | `segurasist-infra/envs/{dev,staging}/providers.tf` | High | Structure/Drift | Sólo `prod/providers.tf:50-64` declara el alias `aws.us_east_1`. `dev` y `staging` lo omiten (verificado). Cuando staging promueva Amplify CLOUDFRONT WAF (sprint 5) se va a copiar el block desde prod manualmente → diff de 3-way entre envs. Ya hubo error en A9-07 (`rate_limit_per_5min` vs `rate_limit_per_ip` shape diff). | Replicar el provider alias en `dev/staging/providers.tf` aunque hoy esté sin uso. Idempotente. Agrega solo 15 líneas y elimina divergencia futura. |
| **B9-31** | `segurasist-api/src/infra/aws/ses.service.ts:149-171` | High | Compliance/Email | Verificado: `sendViaSes` desestima `headers` (línea 154 `void _headersUnused`). Esto rompe el contrato `X-Tag-cert` que el Configuration Set en Terraform espera (re-confirma A4-23). Implicaciones: <br>(a) SES Configuration Set tags inútiles en prod;<br>(b) SNS event destination filtering por tag no funciona;<br>(c) métricas CloudWatch dimensionadas por tag (CW alarm de bounce-rate por tipo de email) no se generan. → Bloquea A9-03 alarms-by-email-type. | Migrar a `SendRawEmailCommand` para inyectar headers MIME custom + tags. O usar `SendEmailCommand`'s `Tags` parameter (SES v3 SDK lo soporta nativamente vía `MessageTag[]` en lugar de headers). Sprint 4 si SES alarms forman parte de `B9-03`. |
| **B9-32** | `segurasist-api/src/workers/mailpit-tracker.service.ts:85` | High | DX/Test | El tracker query es `tag:cert` (URL-encoded `tag%3Acert`). Mailpit indexa **tags** sólo si el cliente nodemailer setea el header `X-Tag` (sin sufijo) o el destinatario incluye un tag explícito. SesService NO setea tag (ver B9-31), por lo tanto **el tracker dev nunca encuentra mensajes** → polling silencioso → Mailpit no sintetiza eventos `delivery/bounce` para certs en dev (re-confirma A4-27). | Decidir: (a) setear header `X-Tag: cert` en `sendViaSmtp` (Mailpit sí lo respeta); o (b) cambiar el query a `subject:certificate` que es más estable. Test integración cert-email-flow.spec.ts:56 ya está env-gated → activar en CI Sprint 4. |
| **B9-33** | `segurasist-infra/Makefile` (entero, 104 líneas) | High | DX/Compliance | Targets ausentes para operación crítica:<br>– `make alarms ENV=…` (apply selectivo de alarms cuando estén instanciadas);<br>– `make irp-drill` (smoke test runbook actionability);<br>– `make backup-verify ENV=…` (chequeo cross-region del flujo backup→restore→sha256 — relacionado con el gap de scripts);<br>– `make rotate-secrets ENV=…` (ADR-009/AWS-001).<br>El Makefile sólo cubre core terraform (init/plan/apply/destroy/fmt/validate/lint/docs/clean). | Sprint 4 agregar los 4 targets, vincular a CI scheduled runs (gitleaks ya corre weekly Mon 07:00, agregar `irp-drill` mensual). |
| **B9-34** | `segurasist-api/scripts/{backup,restore}.sh` | High | DR/Compliance | Verificado:<br>– `backup.sh` no tiene cross-region replication (ni LocalStack ni `--copy-source`).<br>– `restore.sh` no valida que `EXPECTED_SHA` venga del bucket inmutable (Object Lock); cualquier atacante con write al bucket regular puede subir un dump+sha256 fake. <br>– Ningún script verifica que el bucket destino esté en una región DIFERENTE al primario (cross-region geo-failover esperado por ADR-014).<br>– No hay `restore.sh --dry-run` para drill mensual. | Agregar opciones `--cross-region us-east-1` (segundo upload), `--source-bucket-must-have-object-lock` validation, `--dry-run`. Documentar en RB-008 PITR el procedimiento. |
| **B9-35** | `segurasist-infra/docs/runbooks/` + `segurasist-infra/docs/security/IRP.md` | High | Compliance/Operability | Verificado: 9/12 runbooks tienen `> TBD` en symptom/diagnosis/recovery (RB-001..009, RB-010). 11/12 hacen referencia a alarmas que NO están instanciadas en Terraform (B9-03). El IRP.md es esqueleto puro: roles/severities/phases/communication-tree/evidence todos `TBD`. **Implicación regulatoria LFPDPPP**: si un incidente ocurre antes de Sprint 5, el equipo no tiene playbook actionable; el AVISO_PRIVACIDAD del LEG-001 menciona "registros 24m" pero el IRP no traza cómo extraerlos. | Sprint 4 **no opcional**: completar RB-001/005/008/010 + IRP.md con contenido mínimo viable. Tabletop exercise. Después: P95 sigue completar resto. |
| **B9-36** | `segurasist-infra/global/organization/scps/deny-s3-object-lock-delete.json:14` | High | Security/SCP | Re-confirma A9-16. El SCP `deny-s3-object-lock-delete` exime `arn:aws:iam::*:role/AWSReservedSSO_AdminFullAccess_*` de no poder borrar Object Lock. **Contradicción con ADR-009** (Object Lock COMPLIANCE 24m). Si bien técnicamente AWS no permite delete en COMPLIANCE mode, este SCP transmite la señal contraria al equipo: alguien con SSO Admin **puede** intentarlo, fallará por el modo, no por el SCP. Eso desensibiliza al equipo a la política. | Quitar la excepción. Si rompe algún workflow legítimo (recreación de bucket en disaster recovery), agregar break-glass via root account con MFA + auditoría manual. |
| **B9-37** | `segurasist-api/scripts/{local-up,cognito-local-bootstrap,localstack-bootstrap}.sh` | Medium | DX/Onboarding | Pre-checks de binarios sin versión mínima:<br>– `local-up.sh:38`: `psql` sin versión (apply-rls usa `DROP POLICY IF EXISTS` PG10+).<br>– `localstack-bootstrap.sh:25`: `aws CLI` sin versión (S3 Object Lock requiere v2.x).<br>– `cognito-local-bootstrap.sh`: similar.<br>– `backup.sh:88`: `pg_dump` sin versión (custom format requiere PG9.4+, en práctica PG14+).<br>Re-confirma A9-12. | Crear `scripts/lib/preflight.sh` con `require_min_version(cmd, version, install_hint)`. Vincular `Brewfile` o `mise.toml` (si existe) para fixear versiones. Documentar `LOCAL_DEV.md` con tabla. |
| **B9-38** | `segurasist-infra/global/iam-github-oidc/main.tf:5` | Medium | Security | Re-confirma A9-13: `github_thumbprint` único hardcoded. Si GitHub rota CA fuera de banda, OIDC deja de funcionar y los workflows quedan ciegos hasta que alguien actualice el thumbprint. | Pasar **dos** thumbprints (`6938fd4d98bab03faadb97b34396831e3780aea1` + `1c58a3a8518e8759bf075b76b750d4f2df264fcd`). Documentar en ADR-011 el procedimiento de rotación. |
| **B9-39** | `docs/INTERIM_RISKS.md:58-69` | Medium | Compliance | Verificado: `WAF apply diferido a Sprint 5` pero **no hay fecha concreta**. Sólo "Sprint 5" textual (líneas 58, 60, 61, 69). Sprint 5 no tiene fecha cerrada en `docs/PROGRESS.md` (kickoff post AWS-001 cerrado). LFPDPPP no exige WAF perimetral pero el SOC 2 sí; ningún auditor externo aceptaría "Sprint 5" como fecha. | Agregar deadline ISO-8601 a INTERIM_RISKS sección 1.5: ej `Apply target: 2026-06-30 (Sprint 5 close)`. Coordinar con AWS-001 ETA. Si AWS-001 no cierra Q2, escalar como ítem de bloqueo P1. |
| **B9-40** | `external/AWS-001..004` | Medium | Documentation | Verificado AWS-001/002/003/004: docs ya están actualizados con `mx-central-1` (AWS-001 línea 38, AWS-002 línea 19, AWS-003 línea 49, AWS-004 título y body completo). **Pero**: AWS-004 línea 26 (Cognito) recomienda **fallback a us-east-1** (datos personales en EE.UU. requiere addendum DPA + notificar a MAC). Esto contradice el supuesto de soberanía de datos del Aviso de Privacidad LEG-001. Si Cognito mx-central-1 no llega a tiempo Sprint 5, hay un decision-gate Legal + DPA. | Sprint 4: confirmar disponibilidad Cognito mx-central-1 vía AWS support ticket. Si no disponible, abrir LEG-002 para addendum DPA con MAC antes de provisionar Cognito en us-east-1. |
| **B9-41** | `segurasist-infra/.github/workflows/security-scan.yml:22-34` | Medium | DX | Re-confirma A9-20: Checkov `soft_fail: false` + `download_external_modules: true` sin baseline de excepciones; cualquier CKV trivial bloquea PRs en cuanto OIDC desbloquee. tfsec corre con `full_repo_scan: true` y produce SARIF pero no se filtran false-positives. | Agregar `.checkov.yaml` + `.tfsec.yml` con baseline + lista de excepciones documentadas en ADR. Sprint 4 antes del primer apply. |
| **B9-42** | `.github/workflows/ci.yml:585-631` | Medium | CI/Gating | El gate `ci-success` no incluye en sus `needs` un `infra-lint` (terraform fmt + validate de los modules antes de cada PR que toque `segurasist-api/`). Hoy sólo `segurasist-infra/` tiene su propio workflow `terraform-plan.yml` (separado). Resultado: un PR que cambie `apprunner-service/main.tf` desde `segurasist-api` (impossible hoy pero gap futuro) NO levantaría `terraform fmt -check`. | (a) Mantener separación de workflows actual; (b) documentar en `README.md` del repo raíz que **toda** modificación a `segurasist-infra/` debe pasar por su propio `terraform-plan.yml`; (c) agregar `paths-ignore: ['segurasist-infra/**']` explícito en ci.yml para hacer la separación visible. |
| **B9-43** | `.github/workflows/ci.yml` + `.github/workflows/terraform-*.yml` (paths) | Low | CI/Hygiene | Ambos workflows raíz y `segurasist-infra/.github/workflows/*` viven en repos distintos lógicamente (mono-repo hoy, multi-repo planeado per GH-001) pero comparten el mismo OIDC provider y pueden tener race conditions en concurrency groups (`tf-apply-${{ github.ref }}` vs `ci-${{ github.ref }}`). Nada explosivo hoy. | Documentar policy de release-train: tag `v*` dispara apply prod; PR a main no toca prod. Agregar lock vía GitHub Environment + manual approval (ya existe para staging/prod, verificar). |

## Patrones cross-cutting (sistemic findings)

### 1. SQS standard vs FIFO drift (3 áreas + módulo)

| Área | Finding | Cola |
|---|---|---|
| A3-31 | `MessageDeduplicationId` enviado a colas standard | LocalStack/insureds-creation |
| A5-37 | Mismo issue, distinta cola | reports-queue |
| A9-09 | Terraform queues `fifo_queue=false` por default | layout/cert/email/reports |
| **B9-27** (nuevo) | `insureds-creation` ni siquiera se provisiona | mx-central-1 |

**Decisión sugerida** (cross-team Sprint 4):
- **Opción A — eliminar `dedupeId` del SqsService**: idempotencia ya implementada en DB (status check). Cero cambio Terraform. Recomendada.
- **Opción B — convertir las 4 queues a `.fifo`**: requiere `MessageGroupId` en cada send (qué usar como group? `tenant_id`? `batchId`?). Cuello de botella throughput (300 msg/s/group). Más complejo.

**LocalStack vs AWS real diff**: LocalStack 3.7 acepta `MessageDeduplicationId` en cola standard sin error (silently ignored). AWS real responde `InvalidParameterValue`. Por eso el bug no aparece en e2e-spec con LocalStack.

### 2. Env schema drift (4 áreas)

| Área | Variable | Problema |
|---|---|---|
| A3-32 | `SQS_QUEUE_INSUREDS_CREATION` | Ausente en `.env.example` y `env.schema.ts`; worker la fabrica via `String.replace`. |
| A5-37 | `SQS_QUEUE_REPORTS` (existe) | OK pero standard queue mientras que el código asume idempotencia FIFO. |
| A6-48 | `DATABASE_URL_AUDIT` | Opcional sin alarma operativa; degradación silenciosa pino-only. |
| **B9-28** (nuevo) | 8 variables | `MAILPIT_API_URL`, `EMAIL_FROM_CERT`, `CERT_BASE_URL`, `INSURED_DEFAULT_PASSWORD`, `OTP_*` (3), `EMAIL_TRANSPORT/SMTP_*` no documentados en `.env.example`. `ENABLE_SWAGGER` dead. |
| A7-60 | `API_BASE_URL` | Defaults inconsistentes (proxy → prod, otros → localhost). |
| A8-51 | `PORTAL_SESSION_COOKIE` | Proxy importa la cookie equivocada (admin en lugar de portal). |

**Recomendación**: agregar test `config/env-contract.spec.ts` que parse `.env.example` y compare keys (set-equality) contra `EnvSchema.shape`. Falla CI si hay drift. Aplicar también a `apps/admin/.env.local` y `apps/portal/.env.local`.

### 3. CI gaps para patrones de seguridad (3 áreas)

| Área | Pattern | Detector hoy |
|---|---|---|
| A1-21 | JwtAuthGuard no APP_GUARD global | Ninguno |
| A4-25 | Webhook público sin throttle | Ninguno (Semgrep p/owasp-top-ten no lo cubre) |
| A7-57 | Logout por GET sin Origin check | Ninguno |
| A6-49 | Throttler tenant inconsistente | Ninguno |

**Recomendación B9-29**: agregar `.semgrep/segurasist.yml` con custom rules ts/nest. Ej:

```yaml
rules:
  - id: nest-controller-without-jwt-guard
    pattern-either:
      - pattern: "@Controller(...)\nexport class $C { ...$M }"
    pattern-not-inside: |
      @Public()
      ...
    pattern-not: |
      @UseGuards(...JwtAuthGuard...)
    severity: ERROR
```

## Compliance Sprint 5 visibility

- **WAF apply diferido**: B9-39. INTERIM_RISKS sección 1.5 sin fecha ISO-8601.
- **AWS-001..004 docs**: actualizados con `mx-central-1` ✓ (B9-40 — pero Cognito mx-central-1 todavía sin confirmar disponibilidad — abrir AWS support ticket en Sprint 4).
- **Region `mx-central-1` en Terraform**: ✓ (`envs/{dev,staging,prod}/main.tf:8` y `terraform-plan.yml:20`).
- **LocalStack diff con AWS real**:
  - SQS standard acepta `MessageDeduplicationId` silente vs AWS real `InvalidParameterValue` → B9-27.
  - LocalStack `mx-central-1` no soportado, forzado `us-east-1` en `localstack-bootstrap.sh:17` → divergencia conocida y documentada.
  - Object Lock en LocalStack es emulación (INTERIM_RISKS:41).

## Append al feed compartido

```
[B9] 2026-04-25 21:00 Critical segurasist-api/prisma/rls/policies.sql:49-64 — exports table NO incluida en array tenant-iso, re-aplicar apply-rls.sh post-migración deja exports SIN RLS. // A2 (RLS) confirma; A5 (reports/exports) impacta.
[B9] 2026-04-25 21:00 Critical segurasist-api/src/workers/insureds-creation-worker.service.ts:63 — replace() de SQS_QUEUE_LAYOUT funciona en LocalStack; en AWS real falla con QueueDoesNotExist (Terraform no provisiona insureds-creation, env var no existe). // Bloquea Sprint 5 deploy real. Cross con A3-31, A3-32, A9-09.
[B9] 2026-04-25 21:00 High segurasist-api/.env.example ↔ env.schema.ts — 8 variables drift (MAILPIT_API_URL, EMAIL_FROM_CERT, CERT_BASE_URL, INSURED_DEFAULT_PASSWORD, OTP_*, ENABLE_SWAGGER dead, SQS_QUEUE_INSUREDS_CREATION ausente). // A6 (DATABASE_URL_AUDIT), A7 (API_BASE_URL), A8 (PORTAL_SESSION_COOKIE) cross.
[B9] 2026-04-25 21:00 High .github/workflows/ci.yml — sin Semgrep custom rules para patrones cross-area (JwtAuthGuard global, webhook throttle, CSRF logout, tenant-throttle consistency). // A1-21, A4-25, A6-49, A7-57.
[B9] 2026-04-25 21:00 High segurasist-infra/envs/{dev,staging}/providers.tf — falta alias us_east_1 (sólo prod lo tiene). // Drift cuando staging promueva CLOUDFRONT WAF Sprint 5.
[B9] 2026-04-25 21:00 High segurasist-api/src/infra/aws/ses.service.ts:149-171 — SendEmailCommand desestima tags/headers con `void _headersUnused`; Configuration Set tags inútil en prod. // A4-23 confirmado; bloquea CW alarms-by-email-type para B9-03.
[B9] 2026-04-25 21:00 Medium docs/INTERIM_RISKS.md:58-69 — WAF apply deferido a "Sprint 5" sin fecha ISO. // SOC 2 audit gap futuro.
```

## Recommendations Sprint 4 (top 5 — actualizado)

1. **Desbloqueo CI/CD real (Critical x3)**: B9-01 SwaggerModule + B9-02 IAM tf_plan_{staging,prod} + B9-29 Semgrep custom rules. Sin esos 3, el gate ci-success no puede pasar verde y todo el flow GitHub Actions queda esperando.
2. **Cerrar gap RLS exports + insureds-creation queue (Critical x2)**: B9-26 agregar `'exports'` a `policies.sql` + B9-27 provisionar queue en Terraform y wirearla en `env.schema.ts`. Antes de habilitar OIDC.
3. **Wirear CloudWatch alarms (Critical/High)**: B9-03 + completar runbooks B9-35 (RB-001/005/008/010 + IRP.md). 7-10 alarmas core mapeadas a runbooks. Cerrar gap H-04 security audit.
4. **Resolver SQS FIFO vs idempotencia DB (sistémico)**: decidir Opción A (eliminar `dedupeId` de SqsService — recomendada) o Opción B (convertir queues a `.fifo`). Aplicar en los 3 envs. Cerrar B9-27 + A3-31 + A5-37 + A9-09 de un golpe.
5. **Endurecer permisos + secrets + envs (High x3)**: B9-06 (PowerUser→inline), B9-30 (us_east_1 alias en dev/staging), B9-38 (dual GitHub thumbprint), B9-31 (SES tags via SendRawEmail). Pre-requisito Sprint 5 deploy.

## Files audited (delta v2)

- `segurasist-api/.env.example` (80 líneas) — re-leído.
- `segurasist-api/src/config/env.schema.ts` (199 líneas) — re-leído.
- `segurasist-api/src/main.ts` (86 líneas) — confirmar Swagger ausente.
- `segurasist-api/src/app.module.ts:91-126` — confirmar APP_GUARD config.
- `segurasist-api/prisma/rls/policies.sql` (98 líneas) — confirmar exports gap.
- `segurasist-api/src/infra/aws/{ses,sqs}.service.ts` — confirmar SES tags + dedupeId.
- `segurasist-api/src/workers/{insureds-creation-worker,mailpit-tracker}.service.ts` — string.replace + tag query.
- `segurasist-api/scripts/{local-up,backup,restore,seed-bulk-insureds,localstack-bootstrap,apply-rls}.sh` — pre-checks + cross-region.
- `segurasist-infra/envs/{dev,staging,prod}/providers.tf` — alias us_east_1.
- `segurasist-infra/global/iam-github-oidc/main.tf` — re-confirmar 2 thumbprints + tf_plan_{staging,prod}.
- `segurasist-infra/.github/workflows/{terraform-plan,terraform-apply,security-scan}.yml` — Trivy ausente, Checkov sin baseline.
- `segurasist-infra/docs/runbooks/RB-{001,005,008,010}.md` + `docs/security/IRP.md` — confirmar TBD.
- `segurasist-infra/docs/security/IRP.md` — esqueleto puro.
- `segurasist-infra/Makefile` — gap targets.
- `external/AWS-{001,002,003,004}.md` — region status.
- `docs/INTERIM_RISKS.md` — WAF deadline.
- `.github/workflows/ci.yml` (632 líneas) — re-leído entero para detección de gates.

Total: 18 archivos re-auditados en v2.
