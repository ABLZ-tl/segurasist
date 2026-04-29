output "sns_topic_arn" {
  description = "Security alerts SNS topic ARN."
  value       = aws_sns_topic.security_alerts.arn
}

output "sns_topic_name" {
  description = "Security alerts SNS topic name."
  value       = aws_sns_topic.security_alerts.name
}

output "guardduty_high_rule_arn" {
  description = "EventBridge rule ARN matching GuardDuty findings >= severity threshold."
  value       = aws_cloudwatch_event_rule.guardduty_high.arn
}

output "securityhub_failed_alarm_arn" {
  description = "CloudWatch alarm ARN for Security Hub failed compliance count."
  value       = aws_cloudwatch_metric_alarm.securityhub_failed_compliance.arn
}

output "slack_forwarder_function_name" {
  description = "Slack forwarder Lambda name. Null when slack_webhook_secret_arn = null."
  value       = var.slack_webhook_secret_arn == null ? null : aws_lambda_function.slack_forwarder[0].function_name
}

output "quarantine_function_name" {
  description = "Auto-quarantine Lambda name. Null when disabled."
  value       = var.enable_auto_quarantine ? aws_lambda_function.quarantine[0].function_name : null
}
