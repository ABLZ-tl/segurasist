output "user_pool_id" {
  description = "Cognito user pool ID"
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "Cognito user pool ARN"
  value       = aws_cognito_user_pool.this.arn
}

output "user_pool_endpoint" {
  description = "Cognito user pool endpoint"
  value       = aws_cognito_user_pool.this.endpoint
}

output "domain" {
  description = "Cognito hosted UI domain (null if not set)"
  value       = length(aws_cognito_user_pool_domain.this) > 0 ? aws_cognito_user_pool_domain.this[0].domain : null
}

output "app_client_ids" {
  description = "Map app_client_name -> client ID"
  value       = { for k, c in aws_cognito_user_pool_client.this : k => c.id }
}

output "group_arns" {
  description = "Map group name -> ARN"
  value       = { for k, g in aws_cognito_user_group.this : k => g.id }
}

output "resource_server_identifiers" {
  description = "List of resource server identifiers"
  value       = [for k, _ in aws_cognito_resource_server.this : k]
}
