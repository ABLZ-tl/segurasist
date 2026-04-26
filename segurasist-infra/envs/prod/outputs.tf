output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "rds_endpoint" {
  description = "RDS endpoint"
  value       = module.rds_main.endpoint
  sensitive   = true
}

output "rds_master_secret_arn" {
  description = "RDS managed master user secret ARN"
  value       = module.rds_main.master_user_secret_arn
}

output "rds_replica_arn" {
  description = "RDS cross-region replica ARN"
  value       = module.rds_main.replica_arn
}

output "apprunner_api_url" {
  description = "App Runner API URL"
  value       = module.apprunner_api.service_url
}

output "ecr_api_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.api.repository_url
}

output "cognito_admin_pool_id" {
  description = "Admin Cognito user pool ID"
  value       = module.cognito_admin.user_pool_id
}

output "cognito_insured_pool_id" {
  description = "Insured Cognito user pool ID"
  value       = module.cognito_insured.user_pool_id
}

output "amplify_admin_app_id" {
  description = "Amplify admin app ID"
  value       = module.amplify_admin.app_id
}

output "amplify_portal_app_id" {
  description = "Amplify portal app ID"
  value       = module.amplify_portal.app_id
}

output "sqs_queue_urls" {
  description = "Map queue name -> URL"
  value       = { for k, m in module.sqs : k => m.queue_url }
}

output "audit_bucket_name" {
  description = "Audit S3 bucket name (Object Lock 24m + cross-region replication)"
  value       = module.s3_audit.bucket_id
}
