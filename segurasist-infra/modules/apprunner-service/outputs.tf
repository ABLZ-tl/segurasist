output "service_arn" {
  description = "App Runner service ARN"
  value       = aws_apprunner_service.this.arn
}

output "service_id" {
  description = "App Runner service ID"
  value       = aws_apprunner_service.this.service_id
}

output "service_url" {
  description = "Default *.awsapprunner.com URL"
  value       = aws_apprunner_service.this.service_url
}

output "instance_role_arn" {
  description = "Instance role ARN (grant additional permissions to this role)"
  value       = aws_iam_role.instance.arn
}

output "ecr_access_role_arn" {
  description = "ECR access role ARN"
  value       = aws_iam_role.ecr_access.arn
}
