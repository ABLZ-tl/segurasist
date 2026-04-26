output "bus_arn" {
  description = "Event bus ARN"
  value       = aws_cloudwatch_event_bus.this.arn
}

output "bus_name" {
  description = "Event bus name"
  value       = aws_cloudwatch_event_bus.this.name
}

output "archive_arn" {
  description = "Event archive ARN (null if disabled)"
  value       = var.archive_enabled ? aws_cloudwatch_event_archive.this[0].arn : null
}
