# G-1 — Iter 1 feed

DevOps DR Drill Lead. Bundle: ejecución (o template) del DR drill, runbook RB-018, ADR-0011, scripts `scripts/dr-drill/`, GH workflow mensual, CloudWatch freshness alarm.

## Entradas

[G-1] 2026-04-28 14:00 iter1 STARTED docs/sprint5/feed/G-1-iter1.md — lectura DISPATCH_PLAN §G-1, MVP_06 §Backup&DR, MVP_08 §Continuity, módulos `rds-postgres` + `s3-bucket` (ya existen, multi-AZ on staging, automated backups 14d, S3 versioning + lifecycle confirmado).

[G-1] 2026-04-28 14:10 iter1 DONE scripts/dr-drill/_lib.sh — helpers comunes (parse_common_flags, log, require, assert_not_prod, run_or_echo, ts_iso/ts_human/epoch_now, log_dir). Default `DRY_RUN=1` cuando no hay `AWS_PROFILE`/`AWS_ACCESS_KEY_ID` ⇒ corrida en laptop dev nunca toca AWS. Refuse-on-AKIA en argv.

[G-1] 2026-04-28 14:25 iter1 DONE scripts/dr-drill/01-snapshot-status.sh — lista RDS automated snapshots últimos 7d + S3 versioning/lifecycle de uploads/certificates/exports/audit. Output markdown table archivado en `.dr-drill-logs/<ts>/`.

[G-1] 2026-04-28 14:40 iter1 DONE scripts/dr-drill/02-rds-pitr-restore.sh — `aws rds restore-db-instance-to-point-in-time` con `TARGET_TIMESTAMP` default 1h ago, multi-AZ off (parallel restore = sample), deletion-protection on (cleanup script lo apaga). Espera `db-instance-available` y emite `RESTORED_DB_IDENTIFIER`/`RESTORED_DB_ENDPOINT`/`RTO_SECONDS` en formato key=value para parsing en orquestador.

[G-1] 2026-04-28 14:55 iter1 DONE scripts/dr-drill/03-s3-versioning-restore.sh — modo single (`--key/--version`) y batch (`--prefix/--before`). Batch usa `jq` para seleccionar la versión más reciente <= cutoff por key. CopyObject con `?versionId=` promueve a HEAD (idempotente).

[G-1] 2026-04-28 15:05 iter1 DONE scripts/dr-drill/04-validate-restored-db.sh — psql contra restored: tenants/insureds/claims-24h + `MAX(AuditLog.createdAt)`. Compara con `DR_EXPECTED_*` (env / flag) y emite `VALIDATION_STATUS=PASS|FAIL` + `VALIDATION_LAST_AUDIT_TS` (insumo del cálculo de RPO).

[G-1] 2026-04-28 15:15 iter1 DONE scripts/dr-drill/05-cleanup.sh — modify deletion-protection off → wait → delete-db-instance --skip-final-snapshot --delete-automated-backups. Soporta `DR_TEMP_BUCKETS` opcional. `assert_not_prod` activo en cada identifier/bucket.

[G-1] 2026-04-28 15:25 iter1 DONE scripts/dr-drill/99-runbook-helper.sh — orquestador 01→02→04 con cronómetro RTO + cálculo RPO (TARGET_TIMESTAMP − VALIDATION_LAST_AUDIT_TS). NO invoca 05 a propósito (el dueño del runbook valida resultados antes de borrar). Tabla markdown final auto-pegada en `.dr-drill-logs/<ts>/99-runbook-summary.md`.

[G-1] 2026-04-28 15:30 iter1 NEW-FINDING gitignore — agregado `.dr-drill-logs/` y `.aws/` para evitar leak accidental de logs/credenciales en repo. `.gitignore` raíz ya cubría `.env*`; el patrón nuevo cubre el output de los scripts.

[G-1] 2026-04-28 15:40 iter1 DONE docs/runbooks/RB-018-dr-drill.md — pre-reqs IAM (`segurasist-dr-runner` role + permisos rds:* + s3:GetObjectVersion + secretsmanager:GetSecretValue), procedimiento 8 pasos (Slack 24h → 01 → 02 → 04 → cálculo RTO/RPO → reporte → 05 → S3 fixture opcional), criterios éxito RTO ≤ 4h / RPO ≤ 15min, escalación CISO si RTO > 4h, caveat LocalStack (sin PITR sub-segundo) ⇒ drill solo contra staging real.

[G-1] 2026-04-28 15:50 iter1 DONE docs/dr-drills/2026-04-29-staging-template.md — TEMPLATE explícito con `[TODO ejecutar drill real]` en cada celda. NO inventé valores. Cuando se ejecute el drill real, el runner copia el archivo a `<YYYY-MM-DD>-staging.md` y reemplaza placeholders con outputs verbatim del orquestador.

[G-1] 2026-04-28 16:00 iter1 DONE docs/adr/ADR-0011-rto-rpo-validated.md — RTO 4h justificado por desglose detect/restore/validate/redeploy/buffer; RPO 15min por WAL archive cadence (5min) + headroom para lag regional. Tabla backup strategy (RDS automated 14d staging / 7d default / **30d prod target Sprint 5**, manual snapshots pre-deploy 30d, S3 versioning + lifecycle, audit Object Lock 730d). Multi-AZ on (zero-RPO AZ failover); cross-region OFF en MVP, deferred Sprint 6+. Test cadence: drill mensual + post-major-release. Tabla resultados con placeholder iter1 + nota explícita de que **NO se ejecutó drill real**.

[G-1] 2026-04-28 16:10 iter1 DONE .github/workflows/dr-drill-monthly.yml — workflow_dispatch + cron `0 9 * * 1` con filtro DAY_OF_MONTH ≤ 7 (GitHub cron no soporta "first Monday" nativo). Currently `if: false` con comentario claro: flippea cuando S5-2 + Tech Lead provisionen el rol OIDC `segurasist-dr-runner`. OIDC role-to-assume + Slack webhook + artifact upload de `.dr-drill-logs/` 90d.

[G-1] 2026-04-28 16:20 iter1 DONE segurasist-infra/modules/dr-drill-alarm/** — módulo Terraform nuevo: SNS topic + opcional Slack subscription + CloudWatch alarm sobre custom metric `SegurAsist/DR.DrillFreshnessDays` con `treat_missing_data=breaching` y threshold 30d. Wired en `envs/staging/main.tf` con `slack_ops_webhook_url` (nuevo var). El custom metric lo publica el orquestador en Sprint 5 iter 2 (TODO declarado en README del módulo y ADR-0011).

[G-1] 2026-04-28 16:30 iter1 NEEDS-COORDINATION S5-2 — coordinación cross-bundle:
  - `dr-drill-alarm` reutiliza `kms_general` (mismo CMK que `security-alarms`) ⇒ no hay drift KMS.
  - El SNS topic es diferente al de S5-2 (`security-alarms`) por separación de blast radius (#ops vs #security).
  - Sprint 5 iter 2: definir si Slack webhook es el mismo secret o uno separado; recomiendo separado (audit clarity).

[G-1] 2026-04-28 16:35 iter1 NEEDS-COORDINATION Tech Lead — necesario para ejecutar drill real:
  - Aprobar provisión rol IAM `segurasist-dr-runner` en cuenta staging (PR Terraform separado, fuera de mi scope iter 1 — depende de `iam-permission-set` module ownership).
  - Aprobar ventana de ejecución (impacto 0: parallel restore).
  - Confirmar baselines `DR_EXPECTED_TENANTS / INSUREDS / CLAIMS_24H` para staging seed actual.

[G-1] 2026-04-28 16:40 iter1 NOT-EXECUTED drill-real — **NO se ejecutó drill real en iter 1**. Razón explícita: sin acceso AWS staging desde el sandbox del runner G-1 + sin aprobación Tech Lead documentada. Todos los outputs en `2026-04-29-staging-template.md` están como `[TODO ejecutar drill real]`. La tabla de resultados en ADR-0011 también declara explícitamente "drill no ejecutado iter 1".

[G-1] 2026-04-28 16:45 iter1 DONE shellcheck local (best-effort) — los 6 scripts pasan sin errores severos. `_lib.sh` se documenta como "sourced, not executed" (refuse-on-direct-execute al inicio del archivo).

[G-1] 2026-04-28 16:50 iter1 NEW-FINDING ADR-0011 §status — la ADR explícitamente acepta el placeholder iter 1; el row de la tabla de resultados se actualiza in-place con `git revert`-friendly diff cuando el drill real corra (sin reescribir la decisión, solo el log de ejecuciones).

[G-1] 2026-04-28 17:00 iter1 iter1-complete — entregables:
  - 7 archivos `scripts/dr-drill/` (_lib + 5 steps + 99 orchestrator) + README, todos con `--dry-run` y `assert_not_prod`.
  - `docs/runbooks/RB-018-dr-drill.md` (200+ líneas, formato consistente con `docs/runbooks/` existentes).
  - `docs/dr-drills/2026-04-29-staging-template.md` (TEMPLATE; sin valores inventados).
  - `docs/adr/ADR-0011-rto-rpo-validated.md`.
  - `.github/workflows/dr-drill-monthly.yml` (gated `if: false`).
  - `segurasist-infra/modules/dr-drill-alarm/**` + wiring en `envs/staging/main.tf`.
  - `.gitignore` actualizado.

## Para iter 2 / cross-cutting

- **G-1 iter 2**: añadir publicación de custom metric `SegurAsist/DR.DrillFreshnessDays` al final de `99-runbook-helper.sh` (1 `aws cloudwatch put-metric-data`).
- **G-1 iter 2**: agregar `tests/dr/seed-canary.sh` para sembrar fixture `dr-drill-fixtures/canary.txt` en uploads (RB-018 §step 8).
- **G-1 iter 2 condicional**: si Tech Lead aprueba, ejecutar drill real y reemplazar placeholders en ADR-0011 + nuevo `docs/dr-drills/<fecha>-staging.md`.
- **S5-2 iter 2**: revisar si `slack_ops_webhook_url` debe leerse de Secrets Manager (consistente con `slack_security_webhook_secret_arn`). Iter 1 lo dejé como variable directa (sensitive) para no bloquear; refactor low-risk.
- **Cross-cutting**: el patrón `assert_not_prod` en `_lib.sh::55` es reutilizable por cualquier script destructivo futuro (cleanup workers, schema rollbacks, etc.). Vale la pena promoverlo a `scripts/_common/assert-not-prod.sh` en Sprint 6.
- **Cross-cutting**: `RB-018 §audit trail` propone agregar `AuditLog` rows con `action='read_viewed' + resourceType='dr.snapshot'` cuando el orquestador corra; coordinar con S5 owner del módulo audit en Sprint 5 iter 2.

## Bloqueos

- **AWS staging access**: sin perfil `segurasist-dr-runner` provisionado en mi sandbox ⇒ no pude ejecutar drill real. Documentado como TODO bloqueante en ADR-0011 + `docs/dr-drills/2026-04-29-staging-template.md`. Esperado destrabar en Sprint 5 iter 2.
- **shellcheck CI**: no existe step de shellcheck en `ci.yml`; mis scripts pasan local pero no hay gate automático. Sugerencia para Sprint 5 iter 2 (no bloqueante).
