variable "name" {
  description = "Serverless cache name"
  type        = string
}

variable "engine" {
  description = "Engine: redis or valkey"
  type        = string
  default     = "redis"
}

variable "major_engine_version" {
  description = "Engine major version (e.g., 7)"
  type        = string
  default     = "7"
}

variable "subnet_ids" {
  description = "Subnet IDs (private-data)"
  type        = list(string)
}

variable "security_group_ids" {
  description = "Security group IDs to attach"
  type        = list(string)
}

variable "kms_key_id" {
  description = "KMS CMK ARN for at-rest encryption"
  type        = string
}

variable "daily_snapshot_time" {
  description = "Daily snapshot start time UTC (HH:MM)"
  type        = string
  default     = "07:00"
}

variable "snapshot_retention_limit" {
  description = "Snapshot retention days"
  type        = number
  default     = 7
}

variable "user_group_id" {
  description = "Optional ElastiCache user group ID for AUTH"
  type        = string
  default     = null
}

variable "max_storage_gb" {
  description = "Cache storage cap in GB"
  type        = number
  default     = 5
}

variable "max_ecpu_per_second" {
  description = "ECPU/sec cap"
  type        = number
  default     = 5000
}

variable "tags" {
  description = "Tags applied to cache"
  type        = map(string)
  default     = {}
}
