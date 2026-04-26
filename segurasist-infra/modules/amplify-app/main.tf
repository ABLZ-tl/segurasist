data "aws_secretsmanager_secret_version" "github" {
  secret_id = var.github_oauth_token_secret_arn
}

locals {
  github_token = jsondecode(data.aws_secretsmanager_secret_version.github.secret_string).token
}

resource "aws_amplify_app" "this" {
  name                 = var.name
  repository           = var.repository
  platform             = var.platform
  build_spec           = var.build_spec
  iam_service_role_arn = var.iam_service_role_arn
  oauth_token          = local.github_token

  enable_basic_auth      = var.enable_basic_auth
  basic_auth_credentials = var.basic_auth_credentials

  enable_branch_auto_build = true

  environment_variables = var.environment_variables

  dynamic "custom_rule" {
    for_each = var.custom_rules
    content {
      source    = custom_rule.value.source
      target    = custom_rule.value.target
      status    = custom_rule.value.status
      condition = custom_rule.value.condition
    }
  }

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_amplify_branch" "this" {
  for_each = var.branches

  app_id      = aws_amplify_app.this.id
  branch_name = each.key
  framework   = each.value.framework
  stage       = each.value.stage

  enable_auto_build           = each.value.enable_auto_build
  enable_pull_request_preview = each.value.enable_pull_request_preview

  environment_variables = each.value.environment_variables
}

resource "aws_amplify_domain_association" "this" {
  count = var.custom_domain == null ? 0 : 1

  app_id                = aws_amplify_app.this.id
  domain_name           = var.custom_domain.domain_name
  wait_for_verification = var.custom_domain.wait_for_verification

  dynamic "sub_domain" {
    for_each = { for s in var.custom_domain.sub_domains : "${s.branch_name}-${s.prefix}" => s }
    content {
      branch_name = sub_domain.value.branch_name
      prefix      = sub_domain.value.prefix
    }
  }

  depends_on = [aws_amplify_branch.this]
}
