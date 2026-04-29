# RB-018 — DR Drill (RDS PITR + S3 versioning restore)

- **Status**: Active (Sprint 5 iter 1, 2026-04-28)
- **Owner**: G-1 (DevOps DR Drill)
- **Cadence**: Monthly + post-major-release
- **Related**: ADR-0011 (RTO/RPO validated), MVP_06 §Backup & DR, MVP_08 §Continuity, scripts under `scripts/dr-drill/`

## TL;DR

We exercise the staging DR path on a recurring cadence to prove that:
- the RDS automated backups are restorable to a chosen point-in-time;
- S3 versioning + lifecycle let us recover deleted/overwritten objects;
- the application schema (tenants, insureds, claims, audit) survives restore.

**Targets**: RTO ≤ 4h, RPO ≤ 15 min (justification in ADR-0011).

The drill **never** runs against prod. The orchestrator and `_lib.sh::assert_not_prod` refuse to execute if the AWS account ID matches `DR_PROD_ACCOUNT_ID` or any identifier contains `-prod-`.

## Pre-requisites

### Access

- **GH Actions (preferred path)**: el workflow `.github/workflows/dr-drill-monthly.yml` asume el rol OIDC `arn:aws:iam::<staging-account-id>:role/segurasist-dr-runner-staging` (módulo Terraform `segurasist-infra/modules/dr-drill-iam`). Permisos mínimos provisionados (Sprint 5 iter 2):
  - `rds:Describe*`, `rds:ListTagsForResource`
  - `rds:RestoreDBInstanceToPointInTime`, `rds:AddTagsToResource`
  - `rds:ModifyDBInstance`, `rds:DeleteDBInstance`, `rds:DeleteDBInstanceAutomatedBackup` — **scoped por tag** `aws:ResourceTag/Purpose = dr-drill-restore`
  - `s3:GetObjectVersion`, `s3:ListBucketVersions`, `s3:GetBucketVersioning`, `s3:GetBucketLifecycleConfiguration`
  - `cloudwatch:PutMetricData` — scoped por `cloudwatch:namespace = SegurAsist/DR`
  - `sts:GetCallerIdentity`
  - `secretsmanager:GetSecretValue` + `kms:Decrypt` sobre el master user secret del RDS staging (paso "Resolve RESTORED_DB_PASSWORD" del workflow). Scope: ARN específico — ver `dr-drill-iam` module vars `rds_master_secret_arns` / `rds_master_secret_kms_key_arns`.
- **Bastion local (fallback)**: AWS CLI ≥ 2.15 con perfil `segurasist-dr-runner` apuntando al mismo rol (assume manual). Mismos permisos.
- A Postgres client (`psql ≥ 14`) on the runner box (validation script).
- `jq` and `aws` CLI on PATH (the `_lib.sh::require` guard fails fast otherwise).

### PRE: aprobación documentada en Linear

Antes de ejecutar **cualquier** drill real (`dry_run=false` en el workflow o `--no-dry-run` en CLI), el runner DEBE:

1. Abrir un issue Linear `DR-DRILL-XX` con: ventana propuesta, baselines (`DR_EXPECTED_*`), runner asignado, plan de comunicación.
2. Etiquetar al Tech Lead y obtener su aprobación explícita en el issue (comentario `Approved` o estado `Ready`).
3. Pegar el link del Linear issue en el comentario de aprobación del workflow run (GitHub Environment `staging-dr` protection rule lo exige).
4. Solo entonces correr el workflow `DR drill (staging) — monthly` con `dry_run=false`, o invocar `99-runbook-helper.sh --no-dry-run` desde el bastion.

El gate de GitHub Environment `staging-dr` + el sub-claim del rol OIDC (`environment:staging-dr`) garantizan que el orquestador NO puede asumir el rol sin pasar por este check (Sprint 5 iter 2).

### Communications

- Notify `#ops` on Slack **24h** before the drill (template at the bottom of this runbook).
- Notify `#oncall` 1h before. Cancel if a P1/P2 incident is live.
- Confirm with the Tech Lead via PR comment that the drill window is approved.

### Environment

```bash
export AWS_PROFILE=segurasist-dr-runner
export AWS_REGION=mx-central-1
export DR_SOURCE_DB_IDENTIFIER=segurasist-staging-rds-main
export DR_RESTORED_INSTANCE_CLASS=db.t4g.small
export DR_RESTORED_SUBNET_GROUP=segurasist-staging-rds-main-subnets
export DR_RESTORED_SG_IDS=<sg-id-from-staging-vpc>
export DR_PROD_ACCOUNT_ID=<prod-account-id>     # safety guard
export DR_EXPECTED_TENANTS=<from staging seeds>
export DR_EXPECTED_INSUREDS=<from staging seeds>
export DR_EXPECTED_CLAIMS_24H=<from staging seeds>
```

`DR_EXPECTED_*` baselines are refreshed monthly by the seed pipeline; pull from `docs/qa/STAGING_BASELINES.md` (Sprint 5 publishes the first row).

## Procedure

### 1. Notify Slack #ops 24h before

Use the template:

```
:rotating_light: DR drill scheduled
- when: <YYYY-MM-DD HH:MM CDMX>
- target: staging RDS PITR + S3 versioning
- runbook: RB-018
- runner: <handle>
- expected impact: NONE (parallel restore — source instance untouched)
```

### 2. Run step 01 — snapshot status

```bash
./scripts/dr-drill/01-snapshot-status.sh > /tmp/dr-step01.md
```

Archive the output and ensure:
- automated snapshots exist for **each** of the last 7 days (no gaps);
- the 4 staging buckets have `Versioning=Enabled`;
- lifecycle rules are present and recent.

If any row is missing, **abort** and open a ticket — there is no point running the rest of the drill until backups are healthy.

### 3. Run step 02 — RDS PITR restore (start cronómetro)

```bash
TARGET_TIMESTAMP=$(date -u -v-1H +"%Y-%m-%dT%H:%M:%SZ")    # 1h ago
./scripts/dr-drill/02-rds-pitr-restore.sh --target "$TARGET_TIMESTAMP" \
  | tee /tmp/dr-step02.md
```

Capture from the output:

```
RESTORED_DB_IDENTIFIER=segurasist-staging-restored-<ts>
RESTORED_DB_ENDPOINT=<host>:5432
RTO_SECONDS=<int>
TARGET_TIMESTAMP=<iso8601>
```

Export the endpoint for step 04:

```bash
export RESTORED_DB_ENDPOINT=...
export RESTORED_DB_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id segurasist-staging-rds-main/master-user-secret \
  --query SecretString --output text | jq -r .password)
```

### 4. Run step 04 — validate restored DB (stop cronómetro)

```bash
./scripts/dr-drill/04-validate-restored-db.sh \
  --expected-tenants "$DR_EXPECTED_TENANTS" \
  --expected-insureds "$DR_EXPECTED_INSUREDS" \
  --expected-claims-24h "$DR_EXPECTED_CLAIMS_24H" \
  | tee /tmp/dr-step04.md
```

Pass criteria:
- All three counts match (`PASS` rows in the table).
- `VALIDATION_STATUS=PASS`.
- `VALIDATION_LAST_AUDIT_TS` is within 15 min of `TARGET_TIMESTAMP` (this is the RPO sample).

### 5. Compute RTO / RPO

```
RTO  = (timestamp end of step 04) - (timestamp start of step 02)
RPO  = TARGET_TIMESTAMP - VALIDATION_LAST_AUDIT_TS
```

The orchestrator `99-runbook-helper.sh` does both calculations automatically and prints a markdown summary table.

Acceptance:
- **RTO ≤ 4h (14 400 s)** — see ADR-0011 §rationale.
- **RPO ≤ 15 min (900 s)** — see ADR-0011 §rationale.

### 6. Document results

Copy the orchestrator summary into `docs/dr-drills/YYYY-MM-DD-staging.md` (template + the iter-1 placeholder live in the same folder). Attach:

- script logs from `.dr-drill-logs/<ts>/`;
- screenshots of the AWS console (RDS instance state, CloudWatch graphs);
- Slack thread permalink (#ops).

Sign the file with the runner's handle and the Tech Lead's approval.

### 7. Run step 05 — cleanup

After the post-drill review (≤ 24h later):

```bash
./scripts/dr-drill/05-cleanup.sh --identifier "$RESTORED_DB_IDENTIFIER"
```

Confirm via console that the restored instance is gone and that no extra snapshots/auto-backups remain (`--delete-automated-backups` is set).

### 8. (Optional) S3 versioning drill

Pick a non-PII path under `s3://segurasist-staging-uploads/dr-drill-fixtures/` and:

```bash
# overwrite + restore
./scripts/dr-drill/03-s3-versioning-restore.sh \
  --bucket segurasist-staging-uploads \
  --key dr-drill-fixtures/canary.txt
```

The fixture is seeded once by `tests/dr/seed-canary.sh` and is **not** real customer data.

## Failure & escalation

| Symptom | Action |
|---|---|
| Step 01 reports missing snapshots | Abort drill. Open S0 ticket → CISO. |
| Step 02 fails with `InvalidRestoreTime` | Retry with `--target` set to the most recent automated snapshot's `LatestRestorableTime`. |
| Step 02 succeeds but `RTO_SECONDS > 14400` | Drill failed. Escalate to CISO + Tech Lead. Corrective actions: bump instance class, enable Multi-AZ on staging, evaluate Aurora Postgres for prod. |
| Step 04 row mismatch (counts off) | Verify the seed baselines in `docs/qa/STAGING_BASELINES.md`. If baselines are stale, re-run with refreshed values. If still mismatched → S1 ticket. |
| `RPO_SECONDS > 900` | Document in the drill report. Investigate WAL archive lag in CloudWatch (`OldestReplicationSlotLag`, `TransactionLogsDiskUsage`). |
| `assert_not_prod` triggers | **Stop**. Verify `AWS_PROFILE`, `DR_PROD_ACCOUNT_ID`, identifier name. Open ticket if a misconfiguration reached the runner. |

## Caveats

- **LocalStack**: the community RDS implementation does **not** support PITR with second-level granularity. Drills must run against the real staging environment. Snapshot-restore-only smoke tests can run locally for plumbing validation but do not satisfy this runbook.
- **Multi-AZ**: staging is single-AZ to keep cost down (see ADR-0011). Production runs Multi-AZ; expect prod RTO to be ~30% lower than staging samples.
- **Cross-region**: not in scope for MVP. ADR-0011 §multi-region status defers cross-region replicas to Sprint 6+.
- **Master password**: managed by Secrets Manager. The validation script reads it from `RESTORED_DB_PASSWORD`. Never log it; never paste it into the drill report.
- **CI execution** (Sprint 5 iter 2): `.github/workflows/dr-drill-monthly.yml` está habilitado. Default `dry_run=true` en cron mensual. El primer drill real lo dispara manualmente el Tech Lead vía `workflow_dispatch` con `dry_run=false`, gated por GitHub Environment `staging-dr` (protection rule = approval requerido). El bastion local sigue siendo fallback válido con el mismo rol asumido manualmente.

## Slack templates

**Pre-drill** (24h before):

```
:rotating_light: *DR drill scheduled*
> when: <YYYY-MM-DD HH:MM CDMX>
> target: staging — RB-018 RDS PITR + S3 versioning
> runner: <handle>
> impact: none (parallel restore)
> opt-out: react :no_entry: by <T-1h> if blocked.
```

**Drill complete** (within 1h of completion):

```
:white_check_mark: *DR drill <YYYY-MM-DD>*
> RTO: <Xh Ym>  / target ≤ 4h
> RPO: <Y min> / target ≤ 15 min
> validation: PASS|FAIL
> report: docs/dr-drills/<YYYY-MM-DD>-staging.md
```

## Audit trail

Every script writes structured logs under `.dr-drill-logs/<ts>/` (gitignored). The runner publishes the relevant logs to the runbook PR or the drill report file. Audit refs in the API DB: `AuditLog` rows with `action='read_viewed'` + `resourceType='dr.snapshot'` (Sprint 5 iter 2 deferred — coordinación con S5-1 module audit).

### CloudWatch DrillFreshnessDays metric (Sprint 5 iter 2)

Al cierre exitoso (`VALIDATION_STATUS=PASS`), el orquestador publica:

```
aws cloudwatch put-metric-data \
  --namespace SegurAsist/DR \
  --metric-name DrillFreshnessDays \
  --value 0 \
  --unit Count \
  --timestamp <iso8601> \
  --dimensions Environment=<env>
```

El módulo `segurasist-infra/modules/dr-drill-alarm` lee esta métrica y dispara `SegurAsist/DR drill due` si pasan más de 30 días sin nuevo `value=0` (`treat_missing_data=breaching`). En dry-run el orquestador imprime el comando con prefix `[DRY-RUN]` (smoke test: `bash scripts/dr-drill/99-runbook-helper.sh --dry-run | grep DrillFreshnessDays`).
