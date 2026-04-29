output "sns_topic_arn" {
  description = "SNS topic ARN used by the alarm and Slack subscription."
  value       = aws_sns_topic.dr_drill_due.arn
}

output "alarm_arn" {
  description = "CloudWatch alarm ARN."
  value       = aws_cloudwatch_metric_alarm.drill_freshness.arn
}
