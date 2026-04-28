output "rule_arn" {
  description = "EventBridge rule ARN."
  value       = aws_cloudwatch_event_rule.this.arn
}

output "rule_name" {
  description = "EventBridge rule name."
  value       = aws_cloudwatch_event_rule.this.name
}

output "schedule_expression" {
  description = "Resolved schedule expression (cron/rate)."
  value       = aws_cloudwatch_event_rule.this.schedule_expression
}
