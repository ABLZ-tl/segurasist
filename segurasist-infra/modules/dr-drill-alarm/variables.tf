variable "name_prefix" {
  description = "Resource name prefix (e.g., segurasist-staging)."
  type        = string
}

variable "environment" {
  description = "Environment dimension (staging | prod)."
  type        = string
}

variable "threshold_days" {
  description = "Days since last successful drill before the alarm fires."
  type        = number
  default     = 30
}

variable "kms_key_arn" {
  description = "KMS CMK used for SNS topic encryption."
  type        = string
}

variable "slack_webhook_url" {
  description = "Optional Slack incoming webhook URL (#ops). When null, no subscription is created."
  type        = string
  default     = null
  sensitive   = true
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
