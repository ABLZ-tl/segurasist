variable "name" {
  description = "Bucket name (must be globally unique)"
  type        = string
}

variable "force_destroy" {
  description = "Allow Terraform to delete non-empty bucket (false in prod)"
  type        = bool
  default     = false
}

variable "block_public_access" {
  description = "Block all public access (always true in default; false only for explicit static-hosting)"
  type        = bool
  default     = true
}

variable "sse_kms_key_arn" {
  description = "KMS CMK ARN for SSE-KMS (required, no AES256 default)"
  type        = string
}

variable "bucket_key_enabled" {
  description = "Enable S3 Bucket Keys (reduces KMS request cost)"
  type        = bool
  default     = true
}

variable "versioning_enabled" {
  description = "Enable object versioning"
  type        = bool
  default     = true
}

variable "object_lock_mode" {
  description = "NONE | COMPLIANCE | GOVERNANCE"
  type        = string
  default     = "NONE"
  validation {
    condition     = contains(["NONE", "COMPLIANCE", "GOVERNANCE"], var.object_lock_mode)
    error_message = "object_lock_mode must be NONE, COMPLIANCE, or GOVERNANCE."
  }
}

variable "default_retention_days" {
  description = "Default object lock retention days (when mode != NONE)"
  type        = number
  default     = 730 # 24 months for audit
}

variable "lifecycle_rules" {
  description = "List of lifecycle rule objects"
  type = list(object({
    id      = string
    enabled = optional(bool, true)
    prefix  = optional(string, "")
    transitions = optional(list(object({
      days          = number
      storage_class = string
    })), [])
    expiration_days                 = optional(number, null)
    noncurrent_expiration_days      = optional(number, null)
    abort_incomplete_multipart_days = optional(number, 7)
  }))
  default = []
}

variable "cors_rules" {
  description = "Optional CORS rules"
  type = list(object({
    allowed_origins = list(string)
    allowed_methods = list(string)
    allowed_headers = optional(list(string), ["*"])
    expose_headers  = optional(list(string), [])
    max_age_seconds = optional(number, 3600)
  }))
  default = []
}

variable "cross_region_replication" {
  description = "Optional cross-region replication"
  type = object({
    enabled                = bool
    destination_bucket_arn = string
    destination_kms_arn    = string
    replica_kms_arn        = optional(string, null)
  })
  default = {
    enabled                = false
    destination_bucket_arn = ""
    destination_kms_arn    = ""
  }
}

variable "log_target_bucket" {
  description = "Optional bucket name to receive S3 access logs"
  type        = string
  default     = null
}

variable "log_target_prefix" {
  description = "Prefix for access log objects"
  type        = string
  default     = "s3-access/"
}

variable "tags" {
  description = "Tags applied to bucket"
  type        = map(string)
  default     = {}
}
