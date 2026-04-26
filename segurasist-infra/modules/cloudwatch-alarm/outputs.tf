output "alarm_arn" {
  description = "CloudWatch alarm ARN"
  value       = aws_cloudwatch_metric_alarm.this.arn
}

output "alarm_name" {
  description = "CloudWatch alarm name"
  value       = aws_cloudwatch_metric_alarm.this.alarm_name
}
