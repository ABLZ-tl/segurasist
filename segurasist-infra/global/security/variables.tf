variable "log_archive_account_id" {
  description = "Account ID of the log-archive account"
  type        = string
}

variable "organization_id" {
  description = "AWS Organizations ID (output of global/organization)"
  type        = string
}

variable "cloudtrail_retention_years" {
  description = "Object Lock retention years for CloudTrail bucket"
  type        = number
  default     = 2
}

variable "tags" {
  description = "Additional tags"
  type        = map(string)
  default     = {}
}
