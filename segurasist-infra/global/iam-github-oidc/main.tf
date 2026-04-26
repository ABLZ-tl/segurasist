locals {
  github_oidc_url   = "https://token.actions.githubusercontent.com"
  github_audiences  = ["sts.amazonaws.com"]
  github_thumbprint = "6938fd4d98bab03faadb97b34396831e3780aea1"

  envs = {
    dev     = { branches = ["main"], tags = ["v*"], deploy_managed_policies = ["arn:aws:iam::aws:policy/PowerUserAccess"] }
    staging = { branches = ["main"], tags = ["v*"], deploy_managed_policies = ["arn:aws:iam::aws:policy/PowerUserAccess"] }
    prod    = { branches = [],       tags = ["v*"], deploy_managed_policies = ["arn:aws:iam::aws:policy/PowerUserAccess"] }
  }

  # subject conditions for terraform-{plan,apply} per env+repo
  infra_sub_pull_request = "repo:${var.github_org}/${var.infra_repo}:pull_request"
  infra_sub_main_branch  = "repo:${var.github_org}/${var.infra_repo}:ref:refs/heads/main"
  infra_sub_release_tag  = "repo:${var.github_org}/${var.infra_repo}:ref:refs/tags/v*"
}

############################################
# Provider in each account
############################################

resource "aws_iam_openid_connect_provider" "github_dev" {
  provider        = aws.dev
  url             = local.github_oidc_url
  client_id_list  = local.github_audiences
  thumbprint_list = [local.github_thumbprint]
}

resource "aws_iam_openid_connect_provider" "github_staging" {
  provider        = aws.staging
  url             = local.github_oidc_url
  client_id_list  = local.github_audiences
  thumbprint_list = [local.github_thumbprint]
}

resource "aws_iam_openid_connect_provider" "github_prod" {
  provider        = aws.prod
  url             = local.github_oidc_url
  client_id_list  = local.github_audiences
  thumbprint_list = [local.github_thumbprint]
}

############################################
# Trust policy helpers
############################################

# Dev account
data "aws_iam_policy_document" "trust_dev_deploy" {
  provider = aws.dev
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_dev.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = local.github_audiences
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_org}/${var.api_repo}:ref:refs/heads/main",
        "repo:${var.github_org}/${var.api_repo}:ref:refs/tags/v*",
        "repo:${var.github_org}/${var.web_repo}:ref:refs/heads/main",
      ]
    }
  }
}

data "aws_iam_policy_document" "trust_dev_tf_plan" {
  provider = aws.dev
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_dev.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = local.github_audiences
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.infra_sub_pull_request, local.infra_sub_main_branch]
    }
  }
}

# Staging account
data "aws_iam_policy_document" "trust_staging_deploy" {
  provider = aws.staging
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_staging.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = local.github_audiences
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_org}/${var.api_repo}:ref:refs/heads/main",
        "repo:${var.github_org}/${var.web_repo}:ref:refs/heads/main",
      ]
    }
  }
}

data "aws_iam_policy_document" "trust_staging_tf_apply" {
  provider = aws.staging
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_staging.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = local.github_audiences
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.infra_sub_main_branch]
    }
  }
}

# Prod account
data "aws_iam_policy_document" "trust_prod_deploy" {
  provider = aws.prod
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_prod.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = local.github_audiences
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_org}/${var.api_repo}:ref:refs/tags/v*",
        "repo:${var.github_org}/${var.web_repo}:ref:refs/tags/v*",
      ]
    }
    # Optional: require GitHub Environment "production" approval claim
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:environment"
      values   = ["production"]
    }
  }
}

data "aws_iam_policy_document" "trust_prod_tf_apply" {
  provider = aws.prod
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_prod.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = local.github_audiences
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.infra_sub_release_tag]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:environment"
      values   = ["production"]
    }
  }
}

############################################
# Roles per env
############################################

# DEV
resource "aws_iam_role" "deploy_dev" {
  provider             = aws.dev
  name                 = "github-actions-deploy-dev"
  assume_role_policy   = data.aws_iam_policy_document.trust_dev_deploy.json
  permissions_boundary = var.permissions_boundary_arn
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "deploy_dev" {
  for_each   = toset(local.envs.dev.deploy_managed_policies)
  provider   = aws.dev
  role       = aws_iam_role.deploy_dev.name
  policy_arn = each.value
}

resource "aws_iam_role" "tf_plan_dev" {
  provider             = aws.dev
  name                 = "github-actions-tf-plan-dev"
  assume_role_policy   = data.aws_iam_policy_document.trust_dev_tf_plan.json
  permissions_boundary = var.permissions_boundary_arn
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "tf_plan_dev_readonly" {
  provider   = aws.dev
  role       = aws_iam_role.tf_plan_dev.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# STAGING
resource "aws_iam_role" "deploy_staging" {
  provider             = aws.staging
  name                 = "github-actions-deploy-staging"
  assume_role_policy   = data.aws_iam_policy_document.trust_staging_deploy.json
  permissions_boundary = var.permissions_boundary_arn
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "deploy_staging" {
  for_each   = toset(local.envs.staging.deploy_managed_policies)
  provider   = aws.staging
  role       = aws_iam_role.deploy_staging.name
  policy_arn = each.value
}

resource "aws_iam_role" "tf_apply_staging" {
  provider             = aws.staging
  name                 = "github-actions-tf-apply-staging"
  assume_role_policy   = data.aws_iam_policy_document.trust_staging_tf_apply.json
  permissions_boundary = var.permissions_boundary_arn
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "tf_apply_staging" {
  provider   = aws.staging
  role       = aws_iam_role.tf_apply_staging.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# PROD
resource "aws_iam_role" "deploy_prod" {
  provider             = aws.prod
  name                 = "github-actions-deploy-prod"
  assume_role_policy   = data.aws_iam_policy_document.trust_prod_deploy.json
  permissions_boundary = var.permissions_boundary_arn
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "deploy_prod" {
  for_each   = toset(local.envs.prod.deploy_managed_policies)
  provider   = aws.prod
  role       = aws_iam_role.deploy_prod.name
  policy_arn = each.value
}

resource "aws_iam_role" "tf_apply_prod" {
  provider             = aws.prod
  name                 = "github-actions-tf-apply-prod"
  assume_role_policy   = data.aws_iam_policy_document.trust_prod_tf_apply.json
  permissions_boundary = var.permissions_boundary_arn
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "tf_apply_prod" {
  provider   = aws.prod
  role       = aws_iam_role.tf_apply_prod.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
