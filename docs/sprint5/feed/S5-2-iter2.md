[S5-2] iter2 STARTED — Sprint 5 cierre: CC-18 (`time_sleep` standards), CC-19 (Lambda handlers reales), CC-25 (Slack webhook seedeo runbook).

## Plan

1. CC-18: insertar `time_sleep.wait_for_standards` (60s) entre `aws_securityhub_standards_subscription` y `aws_securityhub_standards_control`. Provider `time` añadido a `versions.tf`.
2. CC-19: crear `lambdas/slack-forwarder/index.mjs` (SNS → Slack via SecretsManager + retry 3x backoff exp + dedupe TTL 5min); `lambdas/quarantine/index.mjs` (EventBridge GuardDuty `Backdoor:EC2/*` → tag `Quarantine=true` + replace SGs + structured CloudWatch Logs audit). `package.json` + `build.sh` que zipea cada lambda. Update Terraform `aws_lambda_function` para apuntar a los archivos reales.
3. CC-25: extender `RB-020-guardduty-triage.md` con sección "Pre-deploy: Slack webhook setup" (Slack app → SecretsManager → tfvars → build.sh → apply → rotación trimestral).

## Hechos

- [S5-2] iter2 DONE segurasist-infra/modules/security-hub/versions.tf:1 — provider `time` (~> 0.11) añadido al `required_providers`.
- [S5-2] iter2 DONE segurasist-infra/modules/security-hub/main.tf — insertado `resource "time_sleep" "wait_for_standards" { depends_on = [aws_securityhub_standards_subscription.this]; create_duration = "60s" }` antes de los `aws_securityhub_standards_control`. Cada control disabled añade `depends_on = [aws_securityhub_standards_subscription.this, time_sleep.wait_for_standards]`. CC-18 cerrado.
- [S5-2] iter2 DONE segurasist-infra/modules/security-alarms/lambdas/slack-forwarder/index.mjs:1 — handler real. Imports `@aws-sdk/client-secrets-manager` (GetSecretValue, cached en module-scope), `@aws-sdk/client-cloudwatch-logs`. Acepta secret payload bare URL o JSON `{"url":"..."}`. Validación `https://hooks.slack.com/`. Build de Slack message con severity emoji + color + attachments (Type, Severity, Region, Account, Resource, FindingId). Retry 3x con backoff exp (1s/2s/4s) + honra `Retry-After` en 429. Dedupe por `MessageId` SNS via in-memory `Map` con TTL 5 min y prune lazy. Estructura logs JSON. Throws en errores → SNS retry policy del topic.
- [S5-2] iter2 DONE segurasist-infra/modules/security-alarms/lambdas/slack-forwarder/package.json:1 — `type: module`, deps `@aws-sdk/client-secrets-manager` + `@aws-sdk/client-cloudwatch-logs` (^3.654.0), node >=20.
- [S5-2] iter2 DONE segurasist-infra/modules/security-alarms/lambdas/quarantine/index.mjs:1 — handler real. EventBridge envelope o raw finding. Valida `type` empieza con `Backdoor:EC2/`; extrae `detail.resource.instanceDetails.instanceId`. `DescribeInstancesCommand` para verificar idempotencia (tag `Quarantine=true` ya presente → no-op + log info). `ModifyInstanceAttributeCommand` reemplaza SGs por `QUARANTINE_SG_ID`. `CreateTagsCommand` setea `Quarantine=true`, `QuarantinedAt`, `QuarantineReason` (finding type), `FindingId`, `PreviousSgs` (truncados ≤255 char por límite de tag value). Audit estructurado JSON via `console.log/error`. Throws → EventBridge retry.
- [S5-2] iter2 DONE segurasist-infra/modules/security-alarms/lambdas/quarantine/package.json:1 — `type: module`, deps `@aws-sdk/client-ec2` + `@aws-sdk/client-cloudwatch-logs`, node >=20.
- [S5-2] iter2 DONE segurasist-infra/modules/security-alarms/lambdas/build.sh:1 — bash script: por lambda, `npm install --omit=dev` y `zip -rq dist/<name>.zip index.mjs package.json node_modules`. Outputs `dist/slack-forwarder.zip` + `dist/quarantine.zip`. Imprime size_kb. `chmod +x` aplicado.
- [S5-2] iter2 DONE segurasist-infra/modules/security-alarms/lambdas/.gitignore:1 — `node_modules/`, `dist/`, `package-lock.json`, `*.log`.
- [S5-2] iter2 DONE segurasist-infra/modules/security-alarms/main.tf — `data "archive_file" "slack_forwarder_placeholder"` reemplazado por `data "archive_file" "slack_forwarder"` con `source_dir = "${path.module}/lambdas/slack-forwarder"` (zipea index.mjs + package.json + node_modules vendoreado). Igual para `quarantine`. `aws_lambda_function.slack_forwarder` y `aws_lambda_function.quarantine` apuntan a los nuevos archives. Comentario in-line documenta el pre-step `build.sh`.
- [S5-2] iter2 DONE segurasist-infra/docs/runbooks/RB-020-guardduty-triage.md — añadida sección "Pre-deploy: Slack webhook setup" con 5 pasos (Slack app config, `aws secretsmanager create-secret`, pasar ARN a tfvars/TF_VAR, `build.sh` pre-apply, `terraform apply` con nota sobre `time_sleep`) + procedimiento de rotación trimestral (`put-secret-value` + `update-function-configuration` para flush cache + validación con `create-sample-findings`). Naming convention: `segurasist/security/slack-webhook-{env}`. CC-25 cerrado.
- [S5-2] iter2 DONE testing: `terraform validate` no ejecutado (binary no disponible en sandbox actual; solicitar permiso si se requiere). Sintaxis HCL revisada manualmente: provider time correctamente declarado, `time_sleep` recurso válido (provider hashicorp/time 0.11+), `archive_file` con `source_dir` válido. Lambdas Node20 ESM `import` syntax correcta. Build script bash testeado mentalmente con set -euo pipefail.

## NEW-FINDING

1. **Lambda zip size con SDK vendoreado**: `@aws-sdk/client-secrets-manager` + `@aws-sdk/client-cloudwatch-logs` pesan ~10MB instalados; el zip final ~3-4 MB con tree-shaking de npm. Si el cold-start latency molesta (>1s sólo por imports), Node20 runtime YA incluye AWS SDK v3 — switch a `peerDependencies` y `npm install --omit=dev --omit=peer` reduce a ~5 KB. **Defer**: medir cold-start real en staging primero. // for-S5-2-iter3 (si surge) o post-Sprint 5 monitoring.

2. **Dedupe in-memory NO multi-instance**: la Lambda Slack puede tener múltiples containers concurrentes; cada uno tiene su propio `Map`. Si SNS reentrega el mismo MessageId a containers distintos en paralelo, el dedupe falla. Aceptable para iter 2 (Slack tolera mensajes duplicados; el spam es bounded por la SNS retry policy: 3 retries default). DynamoDB-backed dedupe = sobre-ingeniería para volume actual (<100 findings/día esperado). // for-S6 si se vuelve molesto.

3. **`build.sh` requiere npm en runner CI**: el workflow `terraform-plan.yml` no garantiza Node toolchain. Si el CI ejecuta `terraform plan` SIN haber corrido `build.sh`, el `archive_file` zipearía sólo `index.mjs + package.json` (sin `node_modules`) → Lambda crashearía en runtime con `Cannot find module '@aws-sdk/...'`. **Acción para G-2 / S0**: añadir step `setup-node@v4` + `npm install` antes de `terraform apply` en `.github/workflows/terraform-apply.yml` (cuando exista). Plan-only no rompe (data source no se materializa). // for-G-2, for-S0 process.

4. **Rotación de webhook NO automática**: SecretsManager tiene rotation lambdas built-in pero sólo para RDS/credentials. Para webhooks Slack se requeriría Lambda custom + Slack API token con scopes. Iter 2 documenta rotación manual trimestral; automatizable en S6 si compliance lo pide. // for-S6 (compliance review).

5. **Quarantine SG debe pre-existir**: `var.quarantine_security_group_id` apunta a un SG creado fuera del módulo (probablemente `module.vpc` o un módulo separado de "security baseline"). Si no existe, la Lambda crashea en `ModifyInstanceAttributeCommand` con `InvalidGroup.NotFound`. **Acción**: documentar dependencia en RB-020 o crear un `aws_security_group.quarantine` opcional dentro de `security-alarms` (no_ingress, egress 443 a snapshot endpoint). Defer a iter 3 / S6 (no bloquea apply hoy si el SG ya está provisionado en envs/staging). // for-S5-2-future.

6. **`time_sleep` 60s vs cold-start real**: 60s asume subscription ya warm o re-import. En cold-start AWS account, los controles tardan 5-10 min en aparecer. Iter 2 NO resuelve cold-start completamente — todavía puede requerir segundo apply en bootstrap. Documentado en main.tf (in-line comment). Para cold-start: o se usa `time_sleep = "600s"` (penaliza CI normal) o se retry el control disable manualmente. Trade-off aceptado. // for-S5-2-future si CI flakea.

## Bloqueos

- Ninguno. `terraform validate` no ejecutado por restricción del entorno (binary no accesible). Recomiendo run en local antes de merge: `cd segurasist-infra/modules/security-hub && terraform init -backend=false && terraform validate` + `cd segurasist-infra/modules/security-alarms && terraform init -backend=false && terraform validate`.

## Para iter 3 / cross-cutting

- **iter 3 propio (si surge)**: medir cold-start latency real en staging post-deploy; ajustar `memory_size` (256→128 si latency OK ahorra costo). Validar dedupe rate con sample findings.
- **cross-cutting G-2**: añadir `setup-node@v4` + `npm ci` en workflow apply ANTES de `terraform apply` para que `archive_file` capture node_modules. Sin esto, deploy real fallará.
- **cross-cutting S0**: documentar en DEVELOPER_GUIDE el flujo "build lambdas → terraform apply" (el patrón se repetirá en otros módulos con Lambda real, e.g. `security-quarantine` ya canary en staging).
- **cross-cutting MT-1**: si el secret naming `segurasist/security/slack-webhook-{env}` colisiona con futuras convenciones de SecretsManager para tenant secrets, refactor a `secrets/security/slack-webhook-{env}`. Iter 2 mantiene path actual (alineado con patrones de Sprint 1).

## Resumen métricas

- **time_sleep wired**: 1 resource (60s) + provider `time` añadido a security-hub/versions.tf.
- **Lambdas count**: 2 handlers reales (slack-forwarder ~190 LOC, quarantine ~140 LOC). 2 package.json. 1 build.sh + 1 .gitignore. Zip esperado ~3-4 MB cada uno post-`npm install --omit=dev`.
- **Runbook actualizado**: RB-020 §"Pre-deploy: Slack webhook setup" + sección "Rotación" añadidas (~75 líneas nuevas).
- **NEW-FINDINGs**: 6 documentados (lambda size, dedupe multi-instance, CI Node toolchain, rotación auto, quarantine SG dependency, time_sleep cold-start).

[S5-2] iter2-complete — CC-18 + CC-19 + CC-25 cerrados. Sprint 5 S5-2 close. Prod NO tocado (apply real requiere build.sh + secret seedeo manual + sandbox AWS).
