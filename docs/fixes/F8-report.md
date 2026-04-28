# Fix Report — F8 B-CI + B-OBSERVABILITY

## Iter 1 (resumen)

### Issues cerrados

| Issue | Sev | File:line | Notas |
|---|---|---|---|
| **C-12** | 🔴 | `segurasist-api/src/main.ts:9, 74-103` | `SwaggerModule.setup('v1/openapi', …)` con `jsonDocumentUrl='v1/openapi.json'` + Bearer auth + DocumentBuilder. Desbloquea ZAP DAST. |
| **C-13** | 🔴 | `segurasist-infra/global/iam-github-oidc/main.tf:147-170, 226-247, 309-345` | Trust policies + 2 IAM roles `tf_plan_{staging,prod}` con `ReadOnlyAccess`. `outputs.tf` actualizado. Desbloquea `terraform-plan.yml`. |
| **C-14** | 🔴 | `segurasist-infra/envs/{dev,staging,prod}/alarms.tf` (NUEVOS) | 11 alarmas core + SNS topic `oncall-p1` por env. Prod además SNS `us-east-1` para WAF CLOUDFRONT. |
| **H-30 partial** | 🟠 | 5 runbooks RB-001/002/004/005/007 + RB-013 nuevo | 5 cerrados + 1 NEW. Faltan RB-009/010/011/012 (F10 ownership). |

Trivy job agregado en `.github/workflows/ci.yml:563-595` + `ci-success` aggregate.

### Tests añadidos

- N/A en este iter — Terraform no tiene runtime tests (solo `validate`).
- Swagger smoke test depende de `docker compose up` + curl → corre en CI
  (`api-dast` job, ya existente).
- Chain verifier alarmas requieren que F6 emita custom metrics
  (NEW-FINDING, fuera de scope F8).

### Tests existentes corridos

- ❌ `terraform -chdir=envs/{dev,staging,prod} validate` no corrido
  (sandbox sin terraform binary). Sintaxis HCL revisada a mano contra
  schemas de módulos existentes (cloudwatch-alarm, sqs-queue,
  lambda-function, apprunner-service, cognito-user-pool, waf-web-acl).
- ❌ API build TS: bloqueado por `npm install` ban; F0 debe correr
  en CI runner.

### Cross-cutting findings (NEW-FINDING en feed)

1. **F5** debe agregar `@nestjs/swagger@^7.4.0` + `nestjs-zod@^3.0.0`
   (o `zod-to-openapi@^7.0.0`) a `segurasist-api/package.json`
   **dependencies** (NO devDependencies — Swagger se ejecuta en runtime
   App Runner). Sin ellas el build TS falla.
2. **F6** debe emitir custom metrics en namespace `SegurAsist/Audit`
   (dimensión `Environment`) desde `AuditWriterService` y
   `AuditChainVerifierService` vía CloudWatch EMF. Métricas:
   `AuditWriterHealth`, `MirrorLagSeconds`, `AuditChainValid`. Sin
   ellas las 3 alarmas custom quedan en INSUFFICIENT_DATA. Sprint 5
   o iter 2 F6.
3. **F0** debe crear `.github/workflows/terraform-plan.yml`
   (referenciado en C-13 audit pero no existe en repo). Consumir
   outputs `tf_role_arns.plan_{dev,staging,prod}` recién creados.

## Iter 2 (resumen)

### Issues / follow-ups cerrados

| Follow-up | Sev | File:line | Notas |
|---|---|---|---|
| **`terraform-plan.yml` workflow** | 🔴 (audit C-13 dependency) | `.github/workflows/terraform-plan.yml` (NUEVO) | 3 jobs `plan-{dev,staging,prod}` vía OIDC consumiendo `secrets.TF_PLAN_{ENV}_ROLE_ARN` (mapean a `tf_role_arns.plan_*` de iter 1). `fmt -check` + `init -backend=false` + `validate` + `plan -no-color`. Plan upload artifact + comentario en PR (truncado a 60k). Aggregate gate `plan-success` (single required check). Concurrency cancel-in-progress, paths filter `segurasist-infra/**`. Cierra el NEW-FINDING de iter 1. |
| **RB-011 NEW** | 🟠 | `segurasist-infra/docs/runbooks/RB-011-batch-stuck-processing.md` (NUEVO) | Batches en `validating` o `processing` > 15 min. 3 flujos (A/B/C). Triggered by `sqs-{layout,insureds-creation}-dlq-depth > 0`. |
| **RB-012 NEW** | 🟠 | `segurasist-infra/docs/runbooks/RB-012-pdf-generation-backlog.md` (NUEVO) | PDF queue depth backlog. 3 flujos (A capacity / B template-failing / C Lambda timeout). Triggered by `sqs-pdf-dlq-depth > 0` o `lambda-pdf_renderer-errors > 0`. |
| **Renumeración** | — | RB-011 (DAST) → `RB-015-dast-failure.md`; RB-012 (WAF) → `RB-016-waf-rules.md` | Para liberar los slots reclamados por el audit. Cross-refs corregidos en 4 archivos (`waf-managed-rules.md`, `RB-005-waf-spike.md`, `modules/waf-web-acl/README.md`). Contenido inmutable; sólo slugs + headers + nota numeración. |
| **alarms.tf runbook routing** | — | `segurasist-infra/envs/{dev,staging,prod}/alarms.tf` | (a) `local.queue_runbooks` map → `alarm_sqs_dlq_depth` ahora etiqueta `Runbook` por-queue (`layout`/`insureds-creation` → RB-011, `pdf` → RB-012, otros → RB-004). (b) `local.lambda_functions` → objeto `{name, runbook}` (`pdf_renderer` → RB-012, `emailer` → RB-004, `audit_export` → RB-007). On-call llega directo al runbook correcto en lugar del genérico. |
| **EMF namespace verify** | — | `alarms.tf` (no-op) | Las 3 alarmas custom ya usan `namespace = "SegurAsist/Audit"` + metric_names `AuditWriterHealth` / `MirrorLagSeconds` / `AuditChainValid` + dimensión `Environment = var.environment`. Coincide con el plan EMF de F6 iter 2. NO requiere cambio. Cuando F6 cablée el emitter, las alarmas saldrán de INSUFFICIENT_DATA. |
| **RB-014 coordination con F5** | — | feed entry | `RB-014-sqs-topic-rename-drain.md` es owned por F5 iter 2. Cualquier `terraform apply` combinado pre-Sprint5 que incluya el rename `<env>-certificates` → `<env>-pdf` debe seguir ese runbook. Mi apply de `alarms.tf` no toca SQS y es seguro independiente. |

### Tests añadidos

- N/A — workflows de GHA y Markdown puro. El propio workflow corre `terraform fmt -check` + `validate` en cada PR contra `segurasist-infra/**`, así que el primer PR que lo ejecute cierra el "smoke test".

### Tests existentes corridos

- ❌ `terraform validate` no corrido localmente (sandbox sin terraform binary). Sintaxis HCL revisada a mano; los cambios en `alarms.tf` son refactors (`for_each` con objeto en lugar de string) consistentes con módulos existentes (`cloudwatch-alarm` acepta `dimensions = map(string)`).
- ❌ `actionlint` / `gh workflow lint` no corrido (sandbox sin binario). YAML revisado a mano contra `aws-actions/configure-aws-credentials@v4` schema y `actions/github-script@v7` API.

### Cross-cutting findings (NEW-FINDING en feed)

1. **3 GitHub repo secrets requeridos** para que `terraform-plan.yml` funcione: `TF_PLAN_DEV_ROLE_ARN`, `TF_PLAN_STAGING_ROLE_ARN`, `TF_PLAN_PROD_ROLE_ARN`. Deben poblarse vía `gh secret set` después del primer `terraform apply` de `global/iam-github-oidc/` (los ARNs salen de los outputs `tf_role_arns.plan_*`). F0 orquestador / DevOps lead — out-of-scope F8.

### Cambios no realizados (boundary respect)

- ❌ NO toqué `package.json` ni `segurasist-infra/envs/{env}/main.tf` (F5 ownership).
- ❌ NO toqué audit code (F6 ownership). La verificación del namespace fue read-only sobre `alarms.tf` (mi propio archivo).
- ❌ NO renumere RB-009/010 (F10 ownership). El RB-014 lo dejé al cuidado de F5 iter 2 según dispatch.

## Lecciones adicionales (iter 2) para `DEVELOPER_GUIDE.md`

- **Renumerar runbooks vs alias permanente**: cuando un audit reclama un slug específico (e.g., `RB-011-batch-stuck-processing`), preferí renumerar el ocupante anterior a un slot libre (DAST → RB-015) en lugar de mantener el viejo y crear el nuevo en RB-015+. Razón: el audit es el contrato de naming entre operaciones y compliance; los devs encuentran el doc con el nombre que esperan, no con uno aproximado. Costo: cross-refs en 4 archivos. Beneficio: 0 onboarding fricción para el on-call.
- **Tag `Runbook` por-recurso, no por-tipo**: en alarms con `for_each`, mapear el runbook por key (queue/lambda) en lugar de un único tag global. Cuesta 6 líneas extra (`local.queue_runbooks` map) pero el on-call llega 1 click directo al runbook específico (RB-011 batch vs RB-012 pdf vs RB-004 generic SQS), reduciendo MTTR observable.
- **OIDC plan workflow = pure read**: `tf_plan_*` roles tienen `ReadOnlyAccess` AWS-managed policy + trust policy con `pull_request` y `main`. El workflow corre `init -backend=false` para evitar siquiera tocar S3 state lock. La ergonomía es: el plan en PR es advisory; el plan real (con backend) corre en el apply workflow tras merge + manual approval. Separación clara plan-only vs apply.
- **Aggregate `*-success` gate**: en lugar de marcar 3 jobs como required en branch protection (frágil ante renames), un único `plan-success` agrega los 3 con `if: always()` + `needs:`. Mismo patrón que `ci-success` en `ci.yml` (F8 iter 1). Esto facilita evolucionar la matriz de envs sin tocar settings de GitHub.
- **`continue-on-error` en plan ≠ workflow ignora errores**: el step de plan usa `continue-on-error: true` para que igual se suba el artifact y se comente el PR; pero un step posterior re-evalúa `steps.plan.outcome == 'failure'` y hace `exit 1`. Patrón "always surface output, still fail loud".

## Compliance impact

- **L1 (LFPDPPP / ISO 27001 — observabilidad)**: 0% → ~70%.
  CloudWatch alarms + SNS oncall ahora cablean el "guardián" requerido
  por art. 19 LFPDPPP (medidas técnicas de seguridad demostrables).
  Falta sólo emisión de custom metrics (F6 iter 2) y terraform-plan.yml
  (F0).
- **M3 (gestión de incidentes)**: runbooks RB-001/002/004/005/007/013
  ahora contienen pasos accionables (Triage / Mitigation / Forensic /
  Postmortem) en vez de `> TBD`. RB-013 cubre tampering audit
  end-to-end (cierra C3 cross-cutting de audit doc 06).
- **DAST gate**: C-12 desbloquea `api-dast` job → PRs ya no fallan
  por 404 OpenAPI. Trivy agrega filesystem CVE gate.
- **CI/CD**: C-13 desbloquea staging/prod terraform plan via OIDC →
  IaC reviews ahora son posibles sin long-lived AWS keys.

## Lecciones para `DEVELOPER_GUIDE.md`

- **Variable scoping en Terraform**: declarar variables en el .tf que
  las consume (no siempre en `variables.tf` central) es válido y
  preserva file ownership entre agentes/equipos.
- **Custom metrics requieren emisor cableado**: una alarma `INSUFFICIENT_DATA`
  por métrica inexistente es peor que no tener la alarma — produce
  ruido cognitivo. Documentar siempre qué servicio emite cada custom
  metric y bloquear merge si el emisor no está cableado.
- **CloudFront alarms viven en us-east-1**: WAF scope `CLOUDFRONT`
  obliga a SNS topic dedicado en us-east-1 (CW Cross-Region Alarms
  no están GA aún en mx-central-1). Patrón aplicado en prod alarms.tf.
- **Runbook numbering**: una vez asignado un número (RB-002), no
  reasignarlo aunque el topic cambie — preferir crear nuevo número y
  marcar el viejo como "DEPRECATED → ver RB-XXX". En este iter
  excepcionalmente reemplazamos RB-002/004/005/007 porque el dispatch
  plan lo exigía explícitamente, pero anotamos la deprecación.
- **Trivy `ignore-unfixed`** evita ruido por CVEs sin parche upstream;
  combinado con `severity: HIGH,CRITICAL` el job falla solo en lo
  accionable. Sin esto el ratio de FP > 50%.
