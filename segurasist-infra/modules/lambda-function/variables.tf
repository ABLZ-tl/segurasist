variable "function_name" {
  description = "Lambda function name"
  type        = string
}

variable "description" {
  description = "Lambda description"
  type        = string
  default     = ""
}

variable "runtime" {
  description = "Lambda runtime"
  type        = string
  default     = "nodejs20.x"
}

variable "handler" {
  description = "Lambda handler"
  type        = string
  default     = "index.handler"
}

variable "package_type" {
  description = "Zip or Image"
  type        = string
  default     = "Zip"
}

variable "image_uri" {
  description = "Container image URI (when package_type=Image)"
  type        = string
  default     = null
}

variable "filename" {
  description = "Local zip path (when package_type=Zip). Use placeholder for bootstrap; CI publishes versions."
  type        = string
  default     = null
}

variable "s3_bucket" {
  description = "S3 bucket containing zip artifact (alternative to filename)"
  type        = string
  default     = null
}

variable "s3_key" {
  description = "S3 key of zip artifact"
  type        = string
  default     = null
}

variable "memory_size" {
  description = "Memory MB"
  type        = number
  default     = 512
}

variable "timeout" {
  description = "Timeout seconds"
  type        = number
  default     = 30
}

variable "ephemeral_storage_mb" {
  description = "Ephemeral /tmp storage MB (512-10240)"
  type        = number
  default     = 512
}

variable "architectures" {
  description = "x86_64 or arm64"
  type        = list(string)
  default     = ["arm64"]
}

variable "environment_variables" {
  description = "Plain env vars"
  type        = map(string)
  default     = {}
}

variable "kms_key_arn" {
  description = "KMS CMK ARN for env-var encryption + DLQ"
  type        = string
}

variable "vpc_config" {
  description = "Optional VPC config"
  type = object({
    subnet_ids         = list(string)
    security_group_ids = list(string)
  })
  default = null
}

variable "layers" {
  description = "List of layer ARNs (e.g., Chromium for PDF rendering)"
  type        = list(string)
  default     = []
}

variable "tracing_mode" {
  description = "Active or PassThrough"
  type        = string
  default     = "Active"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention"
  type        = number
  default     = 30
}

variable "reserved_concurrency" {
  description = "Reserved concurrency (-1 = unreserved)"
  type        = number
  default     = -1
}

variable "dlq_kms_key_arn" {
  description = "KMS CMK ARN for DLQ encryption (defaults to kms_key_arn)"
  type        = string
  default     = null
}

variable "dlq_message_retention_seconds" {
  description = "DLQ retention seconds"
  type        = number
  default     = 1209600 # 14 days
}

variable "additional_iam_statements" {
  description = "Extra IAM policy statements (raw JSON-encodable list)"
  type        = list(any)
  default     = []
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}
