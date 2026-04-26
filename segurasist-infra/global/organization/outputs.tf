output "organization_id" {
  description = "AWS Organizations ID"
  value       = aws_organizations_organization.this.id
}

output "organization_arn" {
  description = "AWS Organizations ARN"
  value       = aws_organizations_organization.this.arn
}

output "ou_ids" {
  description = "Map OU name -> OU ID"
  value       = { for k, ou in aws_organizations_organizational_unit.this : k => ou.id }
}

output "scp_arns" {
  description = "Map SCP name -> ARN"
  value       = { for k, p in aws_organizations_policy.scp : k => p.arn }
}

output "sso_instance_arn" {
  description = "IAM Identity Center instance ARN (null if not enabled)"
  value       = length(data.aws_ssoadmin_instances.this.arns) > 0 ? data.aws_ssoadmin_instances.this.arns[0] : null
}

output "sso_identity_store_id" {
  description = "Identity store ID (null if not enabled)"
  value       = length(data.aws_ssoadmin_instances.this.identity_store_ids) > 0 ? data.aws_ssoadmin_instances.this.identity_store_ids[0] : null
}
