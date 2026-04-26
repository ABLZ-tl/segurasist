output "permission_set_arn" {
  description = "Permission set ARN"
  value       = aws_ssoadmin_permission_set.this.arn
}

output "permission_set_name" {
  description = "Permission set name"
  value       = aws_ssoadmin_permission_set.this.name
}
