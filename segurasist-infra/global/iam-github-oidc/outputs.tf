output "oidc_provider_arns" {
  description = "OIDC provider ARN per env account"
  value = {
    dev     = aws_iam_openid_connect_provider.github_dev.arn
    staging = aws_iam_openid_connect_provider.github_staging.arn
    prod    = aws_iam_openid_connect_provider.github_prod.arn
  }
}

output "deploy_role_arns" {
  description = "Deploy role ARNs (assume from app/web GitHub Actions workflows)"
  value = {
    dev     = aws_iam_role.deploy_dev.arn
    staging = aws_iam_role.deploy_staging.arn
    prod    = aws_iam_role.deploy_prod.arn
  }
}

output "tf_role_arns" {
  description = "Terraform role ARNs (assume from infra workflow)"
  value = {
    plan_dev      = aws_iam_role.tf_plan_dev.arn
    apply_staging = aws_iam_role.tf_apply_staging.arn
    apply_prod    = aws_iam_role.tf_apply_prod.arn
  }
}
