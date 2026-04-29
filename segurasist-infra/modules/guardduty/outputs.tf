output "detector_id" {
  description = "GuardDuty detector ID (env-scoped)."
  value       = local.detector_id
}

output "finding_publishing_frequency" {
  description = "Active publishing frequency. Null when detector is org-managed (frequency configured at org level)."
  value       = var.create_detector ? aws_guardduty_detector.this[0].finding_publishing_frequency : var.finding_publishing_frequency
}

output "findings_bucket_name" {
  description = "S3 bucket name receiving findings export. Null if export disabled."
  value       = var.enable_findings_publishing ? aws_s3_bucket.findings[0].id : null
}

output "findings_bucket_arn" {
  description = "S3 bucket ARN receiving findings export. Null if export disabled."
  value       = var.enable_findings_publishing ? aws_s3_bucket.findings[0].arn : null
}

output "publishing_destination_id" {
  description = "GuardDuty publishing destination resource id. Null if export disabled."
  value       = var.enable_findings_publishing ? aws_guardduty_publishing_destination.s3[0].id : null
}

output "trusted_ipset_ids" {
  description = "Map of trusted ipset name -> resource id."
  value       = { for k, v in aws_guardduty_ipset.trusted : k => v.id }
}

output "threat_intel_set_ids" {
  description = "Map of threat-intel set name -> resource id."
  value       = { for k, v in aws_guardduty_threatintelset.malicious : k => v.id }
}
