output "queue_arn" {
  description = "Queue ARN"
  value       = aws_sqs_queue.this.arn
}

output "queue_url" {
  description = "Queue URL"
  value       = aws_sqs_queue.this.url
}

output "queue_name" {
  description = "Queue name"
  value       = aws_sqs_queue.this.name
}

output "dlq_arn" {
  description = "DLQ ARN"
  value       = aws_sqs_queue.dlq.arn
}

output "dlq_url" {
  description = "DLQ URL"
  value       = aws_sqs_queue.dlq.url
}

output "dlq_name" {
  description = "DLQ name"
  value       = aws_sqs_queue.dlq.name
}
