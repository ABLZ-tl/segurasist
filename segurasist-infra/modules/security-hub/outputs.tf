output "standards_subscriptions" {
  description = "Map of enabled standard short-name -> subscription ARN."
  value       = { for k, v in aws_securityhub_standards_subscription.this : k => v.standards_arn }
}

output "disabled_control_arns" {
  description = "List of disabled control ARNs (auto-suppression set)."
  value       = [for c in aws_securityhub_standards_control.disabled : c.standards_control_arn]
}

output "aggregator_arn" {
  description = "Cross-region finding aggregator ARN. Null if disabled."
  value       = var.enable_aggregator ? aws_securityhub_finding_aggregator.this[0].arn : null
}
