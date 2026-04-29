# ADR-0011 — RTO / RPO targets validated via DR drill

- **Status**: Accepted (Sprint 5 iter 1, 2026-04-28)
- **Authors**: G-1 (DevOps DR Drill)
- **Audit refs**: `docs/sprint5/DISPATCH_PLAN.md` §G-1, `docs/runbooks/RB-018-dr-drill.md`, `MVP_06_DevOps_IaC_SegurAsist.docx` §Backup & DR, `MVP_08_Seguridad_Cumplimiento_SegurAsist.docx` §Continuity, `segurasist-infra/envs/staging/main.tf` (rds_main, s3_audit, s3_uploads modules)
- **Trigger**: Sprint 5 DoD requires "DR drill ejecutado y RTO/RPO validados (RTO ≤ 4h, RPO ≤ 15min)". The MVP shipped without a documented DR contract; auditors and Hospitales MAC stakeholders need an explicit, signed off recovery objective.

## Context

SegurAsist persists three classes of state that need a recovery story:

1. **Transactional Postgres state** (RDS `segurasist-prod-rds-main`) — tenants, insureds, claims, audit log, chatbot conversations, certificates metadata. Recovery target dominates the contract because it is the system of record.
2. **Object storage** — S3 buckets `*-uploads` (insured docs), `*-certificates` (PDFs), `*-exports` (admin reports), `*-audit` (compliance log mirror). All buckets have versioning enabled in Terraform; `audit` additionally has Object Lock COMPLIANCE 730d (`segurasist-infra/envs/staging/main.tf` `s3_audit` module).
3. **Configuration / IaC** — Terraform state in S3 + DynamoDB lock. Recoverable from VCS via `terraform apply`; not on the RTO clock.

Hospitales MAC compliance (the contractual customer for MVP Go-Live) requires an SLA aligned with the **NMX-I-27001 / IFT continuity** posture documented in MVP_08. Specifically MVP_08 §Continuity sets:

- Acceptable downtime per quarter: **≤ 8h cumulative** for non-emergency MAC operations.
- Insured-side certificate emission is **near-RT** (insureds expect a PDF in minutes, not hours). However a multi-hour outage in a DR scenario is acceptable as long as the system fully recovers without losing more than a quarter-hour of writes.

These two constraints translate into RTO ≤ 4h and RPO ≤ 15 min.

The MVP currently has the *technical capability* (RDS automated backups 14d retention in staging, 7d in default; PITR enabled; S3 versioning + lifecycle; KMS CMKs separate per domain) but **no documented validation**. ADR-0011 closes that gap by:

- formalising the targets;
- defining the backup strategy and Multi-AZ posture;
- mandating a monthly drill (RB-018) with the ADR result table updated each run;
- recording iter 1 results as a placeholder (drill not executed in iter 1 — see §Status of iter 1 results below).

## Decision

### 1. RTO target — 4 hours

The wall-clock time between "DR event declared" and "API serving traffic from the restored stack" must be ≤ **4 hours** (14 400 s).

Components of the budget:

| Phase | Budget |
|---|---|
| Detect + declare (PagerDuty + Tech Lead approval) | 30 min |
| RDS PITR restore (db.t4g.medium prod, ~50 GiB)    | ~90 min |
| Schema sanity + smoke validation (RB-018 step 04) | 15 min |
| App Runner image redeploy + DNS swap              | 30 min |
| Buffer for paged escalation / slow API calls      | 75 min |

Production multi-AZ shortens the actual restore window (~30% empirically per AWS docs); the budget is sized for the unhappy path.

### 2. RPO target — 15 minutes

We accept losing at most **15 minutes** of database writes if a region-wide RDS failure forces a PITR restore.

This works because:

- RDS automated backups capture WAL every 5 min, so a PITR target older than `LatestRestorableTime` is achievable to within seconds.
- We size the staging drill `TARGET_TIMESTAMP` at **1 hour ago** by default to also exercise the "deeper" PITR window without surprises.
- The 15 min envelope gives headroom for WAL archive lag during a regional incident.

### 3. Backup strategy

| Layer | Mechanism | Retention | Where defined |
|---|---|---|---|
| RDS automated backups | AWS managed daily + WAL                 | **14 d** staging / **7 d** default; **30 d** prod (Sprint 5 hardening) | `segurasist-infra/envs/staging/main.tf:180`, `modules/rds-postgres/variables.tf:77` |
| RDS manual snapshots (pre-deploy) | `aws rds create-db-snapshot` from CI    | **30 d** rolling                                      | `.github/workflows/ci.yml` (S3 hardening Sprint 4) |
| S3 versioning (uploads, certificates, exports, audit) | `versioning_enabled = true`             | non-current expiration: 180 d uploads, 30 d exports, 90 d → DEEP_ARCHIVE on audit | `modules/s3-bucket/main.tf`, env tfvars |
| S3 audit Object Lock COMPLIANCE | `object_lock_mode = "COMPLIANCE"`         | **730 d**                                             | `envs/staging/main.tf:312` `s3_audit` |
| KMS CMKs                | dedicated CMKs per domain (rds, audit, secrets, dr) | rotation enabled, 7-day waiting period on delete | `modules/kms-key/**`, `envs/staging/main.tf:43` |
| Terraform state         | S3 versioning + DynamoDB lock           | indefinite                                           | `segurasist-infra/global/backend/**` |

### 4. Multi-AZ vs Multi-region

| Capability | Status (MVP) | Justification |
|---|---|---|
| RDS Multi-AZ standby (zero-RPO transactional failover for AZ outage) | **Enabled in prod** + staging (cost: ~2× RDS bill but matches SLO) | `multi_az = true` in `envs/staging/main.tf:172` and `envs/prod/main.tf` (S5-2 verifies). |
| Read replica in DR region (`us-east-1`) | **Disabled** in MVP (`cross_region_replica.enabled = false`) | The cross-region cost (storage + transfer) is unjustified pre-Go-Live. Sprint 6+ revisits when MAC opens a second tenant. |
| Cross-account backup (Backup Vault in DR account) | Deferred to Sprint 6+ | Requires AWS Organizations move + Backup Vault Lock; out of MVP scope. |

### 5. Test cadence

- **Monthly drill against staging** — first Monday 09:00 UTC (cron in `.github/workflows/dr-drill-monthly.yml`, **enabled** Sprint 5 iter 2 con default `dry_run=true`; el primer real run requiere aprobación Tech Lead vía GitHub Environment `staging-dr`).
- **Post-major-release drill** — within 2 weeks of any release that mutates RDS schema across tenants (e.g. enum extensions per ADR-0008, RLS policy changes).
- **CloudWatch alarm** — 30 days post last drill triggers SNS → Slack `#ops` "DR drill due". Provisionado por `segurasist-infra/modules/dr-drill-alarm` (Sprint 5 iter 1) sobre la métrica custom `SegurAsist/DR.DrillFreshnessDays` (publicación landed Sprint 5 iter 2 desde `99-runbook-helper.sh`).
- **Drift detection** — RDS automated backup window + retention validated nightly by `tests/dr/backup-config-drift.spec.ts` (placeholder; G-1 owns Sprint 5 iter 2).

### 6. Result acceptance

A drill is considered **successful** if the RB-018 orchestrator produces:

- `VALIDATION_STATUS=PASS` (smoke counts match expected baselines);
- `RTO_SECONDS ≤ 14400`;
- `RPO_SECONDS ≤ 900`.

A failure on any of those triggers the escalation path documented in RB-018 §Failure & escalation.

## Status of iter 1 results

The drill was **not** executed against live AWS in Sprint 5 iter 1. The runner did not have the `segurasist-dr-runner` profile provisioned in time (Tech Lead approval pending — see feed). Iter 1 closes with:

- All 6 scripts under `scripts/dr-drill/` published and idempotent, with `--dry-run` mode.
- Runbook RB-018 published.
- Drill report template published at `docs/dr-drills/2026-04-29-staging-template.md` with explicit `[TODO ejecutar drill real]` placeholders for every result row.
- ADR-0011 (this file) accepted with the placeholder result table below.

| Drill date | RTO sample | RPO sample | Verdict | Report |
|---|---|---|---|---|
| 2026-04-29 (template) | [TODO ejecutar drill real] | [TODO ejecutar drill real] | [TODO] | `docs/dr-drills/2026-04-29-staging-template.md` |

## Status of iter 2 results

Sprint 5 iter 2 cierra el plumbing necesario para ejecutar el drill real:

- **IAM role** `segurasist-dr-runner-staging` provisionado vía `segurasist-infra/modules/dr-drill-iam` con permisos mínimos (rds tag-scoped delete, cloudwatch namespace-scoped put, secrets manager scoped al RDS master secret). Trust policy: OIDC GitHub Actions, audience `sts.amazonaws.com`, sub restringido a `repo:.../ref:refs/heads/main` y `repo:.../environment:staging-dr`.
- **Custom metric** `SegurAsist/DR.DrillFreshnessDays` publicación wired al final de `99-runbook-helper.sh` (solo al éxito del drill, dimension `Environment`). El módulo `dr-drill-alarm` (iter 1) consume esta métrica y dispara post-30d sin actualización.
- **Workflow** `dr-drill-monthly.yml` habilitado (eliminado `if: false`). GitHub Environment `staging-dr` fuerza approval del Tech Lead para `dry_run=false` (alineado con sub-claim del rol OIDC).
- **El drill REAL sigue sin ejecutarse** — se requiere Linear DR-DRILL-XX aprobado por Tech Lead antes del primer `--no-dry-run` (RB-018 §PRE: aprobación documentada). Iter 2 entrega la infraestructura; la ejecución sigue diferida hasta aprobación humana explícita.
- Prod role NO wireado en iter 2 — esperando primer drill exitoso en staging.

## Consequences

### Positive

- Compliance-grade artefact for the MAC contract (auditors get a single doc + drill log trail).
- Forces every Sprint to consider DR impact before merging schema or storage changes (RB-018 §post-major-release clause).
- The `scripts/dr-drill/_lib.sh::assert_not_prod` guard is reusable by other destructive automations (ADR-0011 popularises the pattern).

### Negative / costs

- Drill cost: ~USD 8 per run (db.t4g.small for ~2h, deleted after). Acceptable given monthly cadence.
- Multi-AZ on staging adds ~USD 70/month — the cost is intentional to mirror prod and produce realistic RTO samples.
- Operator burden: 1 hour of runner time + 30 min Tech Lead review per drill. Documented in RB-018.

### Deferred

- Multi-region failover plan (Sprint 6+ — would require ADR-0014 once MAC's geographic posture is final).
- Backup Vault Lock + cross-account copy (Sprint 6+ — needs AWS Organizations move).
- Automated weekly mini-drill exercising only S3 versioning restore (cheaper, faster — proposed for Sprint 5 iter 2 if `cron alerta` lands first).

## References

- `docs/runbooks/RB-018-dr-drill.md`
- `scripts/dr-drill/`
- `segurasist-infra/modules/rds-postgres/main.tf`
- `segurasist-infra/modules/s3-bucket/main.tf`
- `MVP_06_DevOps_IaC_SegurAsist.docx` §Backup & DR
- `MVP_08_Seguridad_Cumplimiento_SegurAsist.docx` §Continuity / SLA
- AWS docs: [Restoring a DB instance to a specified time](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)
