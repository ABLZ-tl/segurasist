variable "organization_feature_set" {
  description = "Organization feature set"
  type        = string
  default     = "ALL"
}

variable "enabled_aws_service_principals" {
  description = "AWS service principals to enable across the org"
  type        = list(string)
  default = [
    "guardduty.amazonaws.com",
    "securityhub.amazonaws.com",
    "config.amazonaws.com",
    "cloudtrail.amazonaws.com",
    "sso.amazonaws.com",
    "ram.amazonaws.com",
    "stacksets.cloudformation.amazonaws.com",
    "inspector2.amazonaws.com",
    "access-analyzer.amazonaws.com",
    "backup.amazonaws.com",
  ]
}

variable "allowed_regions" {
  description = "Regions allowed by SCP (workloads). IAM/CloudFront/etc are exempt."
  type        = list(string)
  default     = ["mx-central-1", "us-east-1"]
}

variable "ous" {
  description = "Map of OU name -> description"
  type        = map(string)
  default = {
    "Security"  = "GuardDuty agg, SH agg, log archive"
    "Workloads" = "dev, staging, prod"
  }
}
