# G-1 — Iter 2 feed

DevOps DR Drill Lead. Sprint 5 cierre. Bundle iter 2: IAM module OIDC + custom metric publish wired + workflow enabled.

## Entradas

[G-1] 2026-04-28 18:00 iter2 STARTED docs/sprint5/feed/G-1-iter2.md — relectura iter1 + `_features-feed.md` CC-20. Plan de objetivos: (1) `dr-drill-iam` module con role + trust OIDC + tag-scoped permissions, (2) `99-runbook-helper.sh` publica `DrillFreshnessDays`, (3) flippear `if: false` + role-to-assume al new role, (4) RB-018 paso PRE Linear approval, (5) NO ejecutar drill real.

[G-1] 2026-04-28 18:10 iter2 DONE segurasist-infra/modules/dr-drill-iam/** — módulo nuevo (4 archivos: main/variables/outputs/versions/README). Role name `segurasist-dr-runner-{env}` parametrizado por `var.environment`. Trust = `aws_iam_policy_document` con principal Federated = `var.oidc_provider_arn`, audience `sts.amazonaws.com`, sub StringLike sobre `repo:{org}/{repo}:ref:refs/heads/<branch>` + `repo:{org}/{repo}:environment:<env>-dr`. Permisos minímos en inline policy: `rds:Restore*`/`Describe*`/`AddTagsToResource` (resources `*`), `rds:ModifyDBInstance` + `rds:DeleteDBInstance` + `rds:DeleteDBInstanceAutomatedBackup` con condición `StringLike aws:ResourceTag/Purpose=dr-drill-restore` (defense-in-depth: el role no puede borrar el RDS source ni nada que NO sea drill-restore). `s3:GetObjectVersion`/`ListBucketVersions`/`GetBucketVersioning`/`GetBucketLifecycleConfiguration` (resources `*`; se puede tightening por bucket vía `extra_s3_arns` futuro). `cloudwatch:PutMetricData` con condición `StringEquals cloudwatch:namespace=SegurAsist/DR`. `sts:GetCallerIdentity`. Dynamic statements opcionales para `secretsmanager:GetSecretValue` + `kms:Decrypt` cuando el caller pasa ARNs concretos del RDS master user secret. Output `role_arn`.

[G-1] 2026-04-28 18:20 iter2 DONE segurasist-infra/envs/staging — wireup módulo `dr_drill_iam`: pasa `var.github_oidc_provider_arn` (nueva variable required, sin default para que `terraform plan` falle ruidoso si se olvida), `github_org`/`github_repo` defaults `segurasist`, `allowed_environments=["staging-dr"]`, `rds_master_secret_arns=[module.rds_main.master_user_secret_arn]`, `rds_master_secret_kms_key_arns=[module.kms_secrets.key_arn]`. Output `dr_drill_runner_role_arn` para que CI/CD pueda leer el ARN sin hardcodearlo. tfvars.example actualizado.

[G-1] 2026-04-28 18:25 iter2 NOT-DONE prod — explícitamente NO wireado en `envs/prod/main.tf` (ADR-0011 §iter 2 status: esperando primer drill staging exitoso antes de promover). Iter 3 / Sprint 6 lo añade.

[G-1] 2026-04-28 18:30 iter2 DONE scripts/dr-drill/99-runbook-helper.sh — bloque al final, post-summary: si `VALIDATION_STATUS=PASS` ejecuta `run_or_echo aws cloudwatch put-metric-data --namespace SegurAsist/DR --metric-name DrillFreshnessDays --value 0 --unit Count --timestamp <iso8601> --dimensions Environment=$DR_ENVIRONMENT` (default `staging`, override via env var). En dry-run, `run_or_echo` imprime con prefix `[DRY-RUN]` ⇒ smoke test passes. Si VALIDATION falla, NO publica el reset (alarma sigue avanzando, comportamiento deseado).

[G-1] 2026-04-28 18:35 iter2 DONE scripts/dr-drill/02-rds-pitr-restore.sh — restore-cmd ahora incluye `--tags Key=Purpose,Value=dr-drill-restore Key=Component,Value=dr-drill Key=Owner,Value=G-1`. Sin esto, las acciones destructivas del role (delete + modify) fallarían con AccessDenied — el tag es contractual con la condición IAM.

[G-1] 2026-04-28 18:40 iter2 DONE .github/workflows/dr-drill-monthly.yml — eliminado `if: false`. Añadido `environment: staging-dr` en el job (forces GitHub Environment protection rule: approval del Tech Lead). `role-to-assume` apunta a `segurasist-dr-runner-staging` (rebranded). `audience: sts.amazonaws.com` explícito. Run orchestrator: default `dry_run=true` (cron), `--no-dry-run` solo via `workflow_dispatch` con approval. `DR_ENVIRONMENT=staging` exportado para el bloque metric publish.

[G-1] 2026-04-28 18:50 iter2 DONE docs/runbooks/RB-018-dr-drill.md — añadido §"PRE: aprobación documentada en Linear" arriba de §Communications. Pasos: (1) abrir Linear DR-DRILL-XX, (2) tag Tech Lead + obtener approval, (3) pegar link en GitHub Environment approval comment, (4) correr workflow con `dry_run=false`. §Access reformulada al rol nuevo + permisos minímos del módulo IAM. §Caveats CI execution ya no dice `if: false`. §Audit trail: bloque nuevo CloudWatch DrillFreshnessDays con el comando exacto.

[G-1] 2026-04-28 18:55 iter2 DONE docs/adr/ADR-0011-rto-rpo-validated.md — §Test cadence: workflow `enabled` (sin `if: false`) + alarm consume métrica publicada. Nuevo §"Status of iter 2 results" con 4 bullets (IAM role, custom metric publish, workflow enable, drill real STILL not executed → require Linear approval).

[G-1] 2026-04-28 19:00 iter2 DONE segurasist-infra/modules/dr-drill-alarm — README actualizado: ya no es "Pending iter 2", es "Status iter 2 DONE". Comentario en main.tf también refleja el wireup.

[G-1] 2026-04-28 19:05 iter2 SMOKE-TEST static-trace `bash scripts/dr-drill/99-runbook-helper.sh --dry-run`:
  - Bash exec restringido en sandbox; verificación estática del flow:
    1. `parse_common_flags --dry-run` ⇒ `DRY_RUN=1`.
    2. Steps 01/02/04 corren con `--dry-run` ⇒ todos imprimen `[DRY-RUN] ...` y retornan 0.
    3. Step 04 dry-run: `cmp` con `expected=""` produce filas `INFO`, `status=0`, output incluye `VALIDATION_STATUS=PASS`.
    4. Orquestador parsea `VALIDATION_STATUS=PASS` ⇒ entra al bloque metric publish.
    5. `run_or_echo aws cloudwatch put-metric-data ...` imprime `[DRY-RUN] aws cloudwatch put-metric-data --namespace SegurAsist/DR --metric-name DrillFreshnessDays --value 0 --unit Count --timestamp <ts> --dimensions Environment=staging` a stderr.
  - Comportamiento esperado match con spec.

[G-1] 2026-04-28 19:10 iter2 NOT-EXECUTED drill-real — sigue NO ejecutado. Razón: requires Linear DR-DRILL-XX aprobado por Tech Lead + GitHub Environment `staging-dr` protection rule configurada (manual setup en GitHub repo settings, fuera de scope Terraform). Iter 2 entrega plumbing 100% — la ejecución es la primera entry posterior con drill real (Sprint 5 iter 3 / Sprint 6 si hay tiempo, o post-Sprint 5 cuando Tech Lead apruebe).

[G-1] 2026-04-28 19:15 iter2 NEW-FINDING github-environment-setup — la protection rule del Environment `staging-dr` (required reviewers = Tech Lead) tiene que crearse manualmente en GitHub repo settings → Environments. Terraform NO lo provisiona (no hay provider oficial). Documentado en RB-018 §PRE como pre-requisito antes del primer real run. Sin la protection rule, cualquier mantenedor con `workflow_dispatch` permission podría correr `dry_run=false` ⇒ riesgo de drill no aprobado.

[G-1] 2026-04-28 19:20 iter2 NEW-FINDING oidc-provider-arn-source — `var.github_oidc_provider_arn` se pasa hoy via tfvars (output manual de `global/iam-github-oidc`). Refactor low-risk Sprint 6: añadir `data "terraform_remote_state" "iam_github_oidc"` en `envs/staging` para leerlo automáticamente (ya hay otros outputs que lo justifican: `tf_role_arns`, `oidc_provider_arns`). No bloqueante; tfvars.example incluye placeholder explícito.

[G-1] 2026-04-28 19:25 iter2 NEW-FINDING tag-scoped-iam — el patrón `aws:ResourceTag/Purpose=dr-drill-restore` para autorizar `rds:DeleteDBInstance` requiere que el tag se aplique **al crear** el recurso (ya está en step 02 después de iter 2). Si alguien restaura manualmente sin tag, el cleanup automático fallará con AccessDenied — comportamiento intencional (defense-in-depth) pero documentar en RB-018 §Failure & escalation futura iteración.

[G-1] 2026-04-28 19:30 iter2 NEEDS-COORDINATION S5-2 — el rol `segurasist-dr-runner-staging` aparecerá en Security Hub findings de "IAM roles without permissions boundary" (depending on framework activations). Recomendación: agregar a `auto_disabled_controls` con razón documentada o setear `permissions_boundary_arn` (módulo lo soporta vía variable). Iter 2 lo deja sin boundary explícito; cualquier policy de gobernanza global se aplicaría vía SCP a nivel Organization.

[G-1] 2026-04-28 19:35 iter2 iter2-complete — entregables:
  - `segurasist-infra/modules/dr-drill-iam/{main,variables,outputs,versions}.tf` + README.
  - `segurasist-infra/envs/staging/{main,variables,outputs,terraform.tfvars.example}.tf` actualizados (3 nuevas vars + module wireup + 1 output).
  - `scripts/dr-drill/99-runbook-helper.sh` — metric publish post-PASS.
  - `scripts/dr-drill/02-rds-pitr-restore.sh` — `--tags Purpose=dr-drill-restore`.
  - `.github/workflows/dr-drill-monthly.yml` — `if: false` removed, env `staging-dr`, role rebranded, default dry-run safety, DR_ENVIRONMENT exported.
  - `docs/runbooks/RB-018-dr-drill.md` — §PRE Linear approval, §Access updated, §CI execution updated, §Audit trail metric block.
  - `docs/adr/ADR-0011-rto-rpo-validated.md` — §Test cadence updated, §Status iter 2 results.
  - `segurasist-infra/modules/dr-drill-alarm/{main,README}.md` — references actualizadas.

## Para iter 3 / Sprint 6

- **Drill real**: bloqueado por aprobación Tech Lead + setup de GitHub Environment `staging-dr` protection rule. Iter 2 entregó toda la plumbing.
- **Prod role**: una vez staging drill exitoso, replicar `dr-drill-iam` en `envs/prod/main.tf` con `allowed_environments=["prod-dr"]` y subset más estricto (solo `workflow_dispatch`, no scheduled).
- **`tests/dr/seed-canary.sh`**: pendiente desde iter 1; sembrar fixture S3 para drill paso 8 opcional (no bloqueante).
- **`tests/dr/backup-config-drift.spec.ts`**: ADR-0011 §Test cadence lo declara como nightly drift check; pendiente.
- **`AuditLog` rows con resourceType='dr.snapshot'**: coordinación con S5-1 para invocar el endpoint audit del orquestador.
- **`terraform_remote_state` data source** en envs/staging para evitar pasar `oidc_provider_arn` por tfvars.

## Bloqueos

- **GitHub Environment `staging-dr` protection rule**: configuración manual en GitHub UI, no Terraform-managed. Sin esto, `--no-dry-run` no está completamente gated. Documentado como pre-req en RB-018.
- **Drill real**: sigue NO ejecutado (require Linear approval Tech Lead). Plumbing 100% lista; ejecución diferida.
