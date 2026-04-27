output "web_acl_arn" {
  description = "WAFv2 Web ACL ARN. Pasalo a aws_apprunner_service.waf_web_acl_arn (REGIONAL) o a aws_cloudfront_distribution.web_acl_id (CLOUDFRONT)."
  value       = aws_wafv2_web_acl.this.arn
}

output "web_acl_id" {
  description = "WAFv2 Web ACL ID (no ARN). Útil para data sources o asociaciones."
  value       = aws_wafv2_web_acl.this.id
}

output "web_acl_name" {
  description = "Web ACL name (mismo que var.name; expuesto para que outputs downstream no tengan que duplicar el cálculo)."
  value       = aws_wafv2_web_acl.this.name
}

output "web_acl_capacity" {
  description = "WCU consumida por el Web ACL. Útil para monitoring (límite por defecto 1500 WCU/Web ACL; >80% justifica abrir un soporte case)."
  value       = aws_wafv2_web_acl.this.capacity
}

output "logging_configured" {
  description = "true si el módulo ajustó logging (var.log_destination_arn != null)."
  value       = var.log_destination_arn != null
}
