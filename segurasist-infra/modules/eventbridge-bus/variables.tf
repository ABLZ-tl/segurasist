variable "name" {
  description = "Custom event bus name"
  type        = string
}

variable "kms_key_arn" {
  description = "KMS CMK ARN for bus encryption (optional but recommended)"
  type        = string
  default     = null
}

variable "archive_enabled" {
  description = "Create event archive for replay"
  type        = bool
  default     = true
}

variable "archive_retention_days" {
  description = "Days to retain archived events (0 = indefinite)"
  type        = number
  default     = 90
}

variable "archive_event_pattern" {
  description = "Optional event pattern (JSON) to filter archived events"
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to bus + archive"
  type        = map(string)
  default     = {}
}
