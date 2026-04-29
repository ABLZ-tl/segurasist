# DR drill — staging — 2026-04-29

> **STATUS: TEMPLATE / PLACEHOLDER (G-1 Sprint 5 iter 1)**
>
> This document is the **canonical template** for every DR drill report. The
> Sprint 5 iter 1 instance is a placeholder because the runner did not have
> live AWS access during this iteration; every value tagged
> `[TODO ejecutar drill real]` must be replaced when the real drill is
> executed (Sprint 5 iter 2 or post-Go-Live month 1).
>
> Do **not** rename this file in place. Copy it to
> `docs/dr-drills/<YYYY-MM-DD>-staging.md` for each new run.

## Run metadata

| Field | Value |
|---|---|
| Drill date (UTC)            | 2026-04-29 [TODO ejecutar drill real] |
| Runbook                     | RB-018 |
| Runner                      | G-1 [TODO replace with handle] |
| Approver (Tech Lead)        | [TODO ejecutar drill real] |
| AWS profile                 | segurasist-dr-runner |
| AWS account ID              | [TODO ejecutar drill real] |
| Region                      | mx-central-1 |
| Source RDS identifier       | segurasist-staging-rds-main |
| Restored RDS identifier     | segurasist-staging-restored-[TODO] |
| Target timestamp (PITR)     | 2026-04-29T13:00:00Z [TODO] |
| Drill window                | 14:00 – 18:00 CDMX [TODO] |
| Slack #ops thread           | [TODO permalink] |

## Step 01 — Snapshot status

> Output of `scripts/dr-drill/01-snapshot-status.sh`. Paste the markdown
> tables here.

### RDS automated snapshots (last 7d)

| SnapshotId | Type | Created | Size GiB | Status |
|---|---|---|---|---|
| [TODO ejecutar drill real] | automated | [TODO] | [TODO] | [TODO] |

### S3 versioning + lifecycle

| Bucket | Versioning | MFADelete | Lifecycle rules | LastNoncurrentTransition |
|---|---|---|---|---|
| segurasist-staging-uploads      | [TODO] | [TODO] | [TODO] | [TODO]d |
| segurasist-staging-certificates | [TODO] | [TODO] | [TODO] | [TODO]d |
| segurasist-staging-exports      | [TODO] | [TODO] | [TODO] | [TODO]d |
| segurasist-staging-audit        | [TODO] | [TODO] | [TODO] | [TODO]d |

**Pre-flight verdict** (block drill if any row missing): [TODO] PASS / FAIL.

## Step 02 — RDS PITR restore

> Output of `scripts/dr-drill/02-rds-pitr-restore.sh`.

| Field | Value |
|---|---|
| TARGET_TIMESTAMP             | [TODO ejecutar drill real] |
| RESTORED_DB_IDENTIFIER       | [TODO] |
| RESTORED_DB_ENDPOINT         | [TODO] |
| Instance class               | db.t4g.small |
| Multi-AZ                     | false (staging — see ADR-0011) |
| Deletion protection          | true (cleanup script disables before delete) |
| RTO_SECONDS (step 02 alone)  | [TODO] |

## Step 03 — S3 versioning restore (optional)

> Run only if the drill includes the S3 path. Use `dr-drill-fixtures/canary.txt`
> in the staging uploads bucket.

| Bucket | Key | Restored versionId | LastModified | Result |
|---|---|---|---|---|
| segurasist-staging-uploads | dr-drill-fixtures/canary.txt | [TODO] | [TODO] | [TODO PASS / FAIL] |

## Step 04 — Validate restored DB

> Output of `scripts/dr-drill/04-validate-restored-db.sh`.

| Metric | Expected | Actual | Status |
|---|---|---|---|
| Tenants count              | [TODO baseline] | [TODO] | [TODO PASS/FAIL] |
| Insureds count             | [TODO baseline] | [TODO] | [TODO PASS/FAIL] |
| Claims created last 24h    | [TODO baseline] | [TODO] | [TODO PASS/FAIL] |
| Last AuditLog timestamp    | (informational) | [TODO]   | INFO |

`VALIDATION_STATUS`: [TODO PASS/FAIL]

## RTO / RPO results

| Metric | Sample | Target | Verdict |
|---|---|---|---|
| RTO (start step 02 → end step 04) | [TODO]s ([TODO human]) | ≤ 14 400 s (4 h) | [TODO PASS/FAIL] |
| RPO (TARGET_TIMESTAMP − last persisted write) | [TODO]s | ≤ 900 s (15 min) | [TODO PASS/FAIL] |

## Step 05 — Cleanup

| Action | Status |
|---|---|
| Disable deletion-protection on restored instance | [TODO] |
| Delete restored DB instance (skip-final-snapshot) | [TODO] |
| Delete temporary buckets (if any)                 | [TODO] |
| Confirm CloudWatch alarms back to baseline        | [TODO] |

## Findings & follow-ups

> Free-form. Document any deviation, unexpected duration, AWS API hiccups,
> tooling improvements, etc.

- [TODO] e.g. "RDS PITR restore took N minutes longer than expected; suspect cause: <X>. Action: <Y>."
- [TODO] e.g. "Add CloudWatch alarm on `OldestReplicationSlotLag` to detect WAL archive lag pre-drill."

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Runner            | G-1 [TODO]              | [TODO] | [TODO]  |
| Tech Lead         | [TODO]                  | [TODO] | [TODO]  |
| CISO (if RTO/RPO miss) | [TODO]              | [TODO] | [TODO]  |

## Attachments

- Script logs: `.dr-drill-logs/[TODO ts]/` (kept locally; uploaded to S3 audit if drill is real).
- AWS console screenshots: [TODO links].
- Slack #ops permalink: [TODO].
