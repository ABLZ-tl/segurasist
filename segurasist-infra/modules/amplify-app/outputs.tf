output "app_id" {
  description = "Amplify app ID"
  value       = aws_amplify_app.this.id
}

output "app_arn" {
  description = "Amplify app ARN"
  value       = aws_amplify_app.this.arn
}

output "default_domain" {
  description = "Default amplifyapp.com domain"
  value       = aws_amplify_app.this.default_domain
}

output "branch_arns" {
  description = "Map branch name -> ARN"
  value       = { for b, br in aws_amplify_branch.this : b => br.arn }
}
