# DR Drill scripts (G-1 Sprint 5)

Scripts that execute and validate the SegurAsist Disaster Recovery drill against the **staging** AWS account. They are referenced by `docs/runbooks/RB-018-dr-drill.md` and `docs/adr/ADR-0011-rto-rpo-validated.md`.

## Files

| Script | Role |
|---|---|
| `01-snapshot-status.sh` | Lists automated RDS snapshots for the last 7d + S3 versioning/lifecycle status of the audit/uploads/certificates/exports buckets. |
| `02-rds-pitr-restore.sh` | Restores the staging RDS instance to a point in time (`TARGET_TIMESTAMP`, default `1h ago`) into a parallel instance `segurasist-staging-restored-{ts}`. Outputs the connection string + total duration. |
| `03-s3-versioning-restore.sh` | Restores a deleted S3 object (or every object under `--prefix`) by promoting a previous version back to HEAD. |
| `04-validate-restored-db.sh` | Runs smoke queries against the restored DB (tenants count, insureds count, recent claims) and compares them to expected values. |
| `05-cleanup.sh` | Deletes the restored RDS instance + cleans temporary buckets created during the drill. |
| `99-runbook-helper.sh` | Orchestrator that runs `01..04` and prints RTO/RPO timestamps. |

## Common conventions

- `--dry-run` flag is supported on every script and is the **default** when `DR_DRILL_DRY_RUN=1` (also default if `AWS_PROFILE` is unset).
- AWS credentials are **never** written to disk. The scripts require an active session for profile `segurasist-dr-runner` (see `RB-018`).
- All scripts are idempotent: re-running them with the same `TARGET_TIMESTAMP` is safe.
- Logs are written to `./.dr-drill-logs/<ts>/<script>.log` (gitignored).

## Quick start

```bash
export AWS_PROFILE=segurasist-dr-runner
export AWS_REGION=mx-central-1
export DR_SOURCE_DB_IDENTIFIER=segurasist-staging-rds-main

# Dry run (safe — only prints AWS CLI commands it WOULD run)
./scripts/dr-drill/99-runbook-helper.sh --dry-run

# Real drill (requires Tech Lead approval per RB-018)
./scripts/dr-drill/99-runbook-helper.sh
```

## Hard rules

- **NEVER** point these scripts at the prod account. The `assert_not_prod` guard will refuse to run if the AWS account ID matches the prod account or the RDS identifier contains `-prod-`.
- **NEVER** commit AWS credentials. `.gitignore` already covers `.env*` + `.aws/`; the scripts also refuse to read credentials passed as flags.
- LocalStack is **not** supported: PITR semantics are not equivalent. The drill must run against real staging.
