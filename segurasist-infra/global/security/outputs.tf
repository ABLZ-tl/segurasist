output "guardduty_detector_id" {
  description = "GuardDuty detector ID in security (admin) account"
  value       = aws_guardduty_detector.this.id
}

output "config_aggregator_arn" {
  description = "Config aggregator ARN"
  value       = aws_config_configuration_aggregator.org.arn
}

output "cloudtrail_arn" {
  description = "Org CloudTrail ARN"
  value       = aws_cloudtrail.org.arn
}

output "cloudtrail_bucket_name" {
  description = "CloudTrail S3 bucket name (in log-archive account)"
  value       = aws_s3_bucket.trail.id
}

output "cloudtrail_kms_key_arn" {
  description = "CloudTrail KMS CMK ARN"
  value       = aws_kms_key.trail.arn
}
