output "bucket_id" {
  description = "S3 bucket name (id)"
  value       = aws_s3_bucket.this.id
}

output "bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.this.arn
}

output "bucket_domain_name" {
  description = "Bucket regional domain name"
  value       = aws_s3_bucket.this.bucket_regional_domain_name
}

output "replication_role_arn" {
  description = "Cross-region replication role ARN (null if disabled)"
  value       = var.cross_region_replication.enabled ? aws_iam_role.replication[0].arn : null
}
