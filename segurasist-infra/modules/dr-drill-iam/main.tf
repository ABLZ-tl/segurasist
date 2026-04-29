############################################
# G-1 Sprint 5 iter 2 — DR drill OIDC runner role.
#
# Provisiona el rol IAM `segurasist-dr-runner-{env}` que GH Actions asume
# vía OIDC (sin credenciales largas) para correr el orquestador del DR
# drill (RB-018, ADR-0011). Permisos mínimos:
#
#   - rds:RestoreDBInstanceToPointInTime  → step 02
#   - rds:Describe*                       → steps 01/02/04
#   - rds:ModifyDBInstance                → step 02 (deletion-protection)
#                                          + step 05 (apaga deletion-protection)
#   - rds:AddTagsToResource               → step 02 (tag Purpose=dr-drill-restore)
#   - rds:DeleteDBInstance                → step 05 — condición `Purpose=dr-drill-restore`
#   - s3:GetObjectVersion                 → step 03
#   - s3:ListBucketVersions               → step 03
#   - cloudwatch:PutMetricData            → step 99 (publica DrillFreshnessDays)
#
# La acción destructiva (`rds:DeleteDBInstance`) está condicionada al tag
# `aws:ResourceTag/Purpose = dr-drill-restore`, por lo que el role no
# puede borrar instancias que NO sean drill-restore (defense-in-depth +
# `assert_not_prod` en `_lib.sh`).
#
# Trust policy: AssumeRoleWithWebIdentity con audience
# `sts.amazonaws.com` y `sub` restringido a:
#   - repo:{org}/{repo}:ref:refs/heads/main
#   - repo:{org}/{repo}:environment:{env}-dr
#
# El segundo `sub` permite que el workflow exija GitHub Environment
# protection rule (review obligatorio del Tech Lead antes de invocar
# `--no-dry-run`). Documentado en RB-018 §pre-requisitos.
############################################

locals {
  role_name = "segurasist-dr-runner-${var.environment}"

  # Subjects = unión de branches + environments.
  trust_subjects = concat(
    [for b in var.allowed_branches : "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/${b}"],
    [for e in var.allowed_environments : "repo:${var.github_org}/${var.github_repo}:environment:${e}"],
  )
}

############################################
# Trust policy
############################################

data "aws_iam_policy_document" "trust" {
  statement {
    sid     = "AssumeRoleWithGitHubOIDC"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.trust_subjects
    }
  }
}

############################################
# Inline permissions policy (least privilege)
############################################

data "aws_iam_policy_document" "permissions" {
  # ---- RDS read --------------------------------------------------------------
  statement {
    sid    = "RdsRead"
    effect = "Allow"
    actions = [
      "rds:DescribeDBInstances",
      "rds:DescribeDBSnapshots",
      "rds:DescribeDBClusters",
      "rds:DescribeDBClusterSnapshots",
      "rds:DescribeDBSubnetGroups",
      "rds:DescribePendingMaintenanceActions",
      "rds:ListTagsForResource",
    ]
    resources = ["*"]
  }

  # ---- RDS PITR restore + tagging --------------------------------------------
  statement {
    sid    = "RdsRestoreAndTag"
    effect = "Allow"
    actions = [
      "rds:RestoreDBInstanceToPointInTime",
      "rds:AddTagsToResource",
    ]
    resources = ["*"]
  }

  # ---- RDS modify (deletion-protection toggle in step 02 + step 05) ---------
  statement {
    sid    = "RdsModifyForDrill"
    effect = "Allow"
    actions = [
      "rds:ModifyDBInstance",
    ]
    resources = ["*"]

    # Solo permitido sobre recursos que tengan tag Purpose=dr-drill-restore
    # (paso 02 lo aplica al crear; paso 05 lo lee antes de borrar).
    condition {
      test     = "StringLike"
      variable = "aws:ResourceTag/Purpose"
      values   = [var.rds_resource_tag_purpose]
    }
  }

  # ---- RDS delete — restringido por tag Purpose ------------------------------
  statement {
    sid    = "RdsDeleteOnlyDrillRestores"
    effect = "Allow"
    actions = [
      "rds:DeleteDBInstance",
      "rds:DeleteDBInstanceAutomatedBackup",
    ]
    resources = ["*"]

    condition {
      test     = "StringLike"
      variable = "aws:ResourceTag/Purpose"
      values   = [var.rds_resource_tag_purpose]
    }
  }

  # ---- S3 versioning restore (step 03) ---------------------------------------
  statement {
    sid    = "S3VersioningRestore"
    effect = "Allow"
    actions = [
      "s3:GetObjectVersion",
      "s3:GetObjectVersionTagging",
      "s3:ListBucketVersions",
      "s3:GetBucketVersioning",
      "s3:GetBucketLifecycleConfiguration",
    ]
    resources = ["*"]
  }

  # ---- CloudWatch custom metric (step 99) ------------------------------------
  statement {
    sid     = "PublishDrillFreshnessMetric"
    effect  = "Allow"
    actions = ["cloudwatch:PutMetricData"]
    # PutMetricData no acepta resources distintos a "*"; la condición sobre
    # namespace es la forma documentada por AWS para limitar el blast radius.
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [var.cloudwatch_metric_namespace]
    }
  }

  # ---- STS read-only (assert_not_prod en _lib.sh) ----------------------------
  statement {
    sid       = "StsCallerIdentity"
    effect    = "Allow"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }

  # ---- Secrets Manager — RDS master password (workflow step) -----------------
  # Solo si el caller pasa ARNs concretos. Default = lista vacía → no statement
  # (Terraform omite el bloque dynamic cuando la lista está vacía).
  dynamic "statement" {
    for_each = length(var.rds_master_secret_arns) > 0 ? [1] : []
    content {
      sid     = "ReadRdsMasterUserSecret"
      effect  = "Allow"
      actions = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
      resources = var.rds_master_secret_arns
    }
  }

  dynamic "statement" {
    for_each = length(var.rds_master_secret_kms_key_arns) > 0 ? [1] : []
    content {
      sid     = "DecryptRdsMasterUserSecret"
      effect  = "Allow"
      actions = ["kms:Decrypt", "kms:DescribeKey"]
      resources = var.rds_master_secret_kms_key_arns
    }
  }
}

############################################
# Role + policy attachment
############################################

resource "aws_iam_role" "this" {
  name                 = local.role_name
  description          = "OIDC role used by GH Actions to run the DR drill orchestrator (RB-018 / ADR-0011)."
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  permissions_boundary = var.permissions_boundary_arn
  max_session_duration = 3600

  tags = merge(var.tags, {
    Name      = local.role_name
    Component = "dr-drill"
    Owner     = "G-1"
  })
}

resource "aws_iam_role_policy" "this" {
  name   = "${local.role_name}-inline"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.permissions.json
}
