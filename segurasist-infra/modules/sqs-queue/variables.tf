variable "name" {
  description = "Queue name (without -dlq suffix)"
  type        = string
}

variable "fifo_queue" {
  description = "FIFO queue (name will get .fifo suffix)"
  type        = bool
  default     = false
}

variable "visibility_timeout_seconds" {
  description = "Visibility timeout"
  type        = number
  default     = 60
}

variable "message_retention_seconds" {
  description = "Message retention"
  type        = number
  default     = 345600 # 4 days
}

variable "max_message_size" {
  description = "Max message size bytes"
  type        = number
  default     = 262144 # 256 KiB
}

variable "delay_seconds" {
  description = "Default delay seconds"
  type        = number
  default     = 0
}

variable "receive_wait_time_seconds" {
  description = "Long polling seconds"
  type        = number
  default     = 20
}

variable "kms_key_arn" {
  description = "KMS CMK ARN for SSE"
  type        = string
}

variable "max_receive_count" {
  description = "Max receives before message goes to DLQ"
  type        = number
  default     = 3
}

variable "dlq_message_retention_seconds" {
  description = "DLQ retention seconds"
  type        = number
  default     = 1209600 # 14 days
}

variable "tags" {
  description = "Tags applied to queue and DLQ"
  type        = map(string)
  default     = {}
}
