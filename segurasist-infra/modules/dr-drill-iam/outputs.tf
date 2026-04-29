output "role_arn" {
  description = "ARN del rol DR drill — usar en `role-to-assume` del workflow `dr-drill-monthly.yml`."
  value       = aws_iam_role.this.arn
}

output "role_name" {
  description = "Nombre del rol (sin prefijo cuenta)."
  value       = aws_iam_role.this.name
}
