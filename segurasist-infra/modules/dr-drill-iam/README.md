# `dr-drill-iam`

OIDC IAM role consumed by the GitHub Actions workflow `dr-drill-monthly.yml` (RB-018 / ADR-0011).

The role grants the **minimum** permissions required by the orchestrator `scripts/dr-drill/99-runbook-helper.sh`:

| Action | Why |
|---|---|
| `rds:Describe*`, `rds:ListTagsForResource` | Steps 01/02/04 inspect snapshots + restored instance state. |
| `rds:RestoreDBInstanceToPointInTime`, `rds:AddTagsToResource` | Step 02 restores into a tagged-`Purpose=dr-drill-restore` instance. |
| `rds:ModifyDBInstance` (tag-scoped) | Steps 02/05 toggle deletion-protection. |
| `rds:DeleteDBInstance`, `rds:DeleteDBInstanceAutomatedBackup` (tag-scoped) | Step 05 cleans up. |
| `s3:GetObjectVersion`, `s3:ListBucketVersions`, `s3:GetBucketVersioning`, `s3:GetBucketLifecycleConfiguration` | Step 03 restores versioned objects. |
| `cloudwatch:PutMetricData` (namespace-scoped) | Step 99 publishes `SegurAsist/DR.DrillFreshnessDays`. |
| `sts:GetCallerIdentity` | `_lib.sh::assert_not_prod` requires it. |

### Trust policy

`AssumeRoleWithWebIdentity` from the GitHub OIDC provider (provisioned by `global/iam-github-oidc/`).

- Audience: `sts.amazonaws.com`.
- Subjects (any of):
  - `repo:{org}/{repo}:ref:refs/heads/main`
  - `repo:{org}/{repo}:environment:{env}-dr` — gated by GitHub Environment protection rule (Tech Lead approval; RB-018 §pre-requisitos).

### Tag-based authorisation

`rds:DeleteDBInstance` is **only** allowed when `aws:ResourceTag/Purpose = dr-drill-restore`. The drill's step 02 tags the restored instance with that value; nothing else in the staging account is tagged that way, so the role cannot delete the source RDS or any unrelated DB even if the orchestrator were misconfigured.

This is defense-in-depth on top of `_lib.sh::assert_not_prod` (account-id + identifier checks at script level).

## Usage

```hcl
module "dr_drill_iam" {
  source = "../../modules/dr-drill-iam"

  environment       = "staging"
  github_org        = "segurasist"
  github_repo       = "segurasist"
  oidc_provider_arn = data.terraform_remote_state.iam_github_oidc.outputs.github_oidc_provider_arns["staging"]

  allowed_branches     = ["main"]
  allowed_environments = ["staging-dr"]

  tags = local.common_tags
}
```

The output `role_arn` is wired into `.github/workflows/dr-drill-monthly.yml` as `role-to-assume` for `aws-actions/configure-aws-credentials@v4`.

## NOT in iter 2

- **Prod role**: Sprint 5 iter 2 wires only `staging`. Prod role provisioning is deferred until staging drill executes successfully and Tech Lead signs off (ADR-0011 §iter 1 status).
- **AWS Backup role**: cross-account backup is deferred to Sprint 6+ (ADR-0011 §multi-region).
