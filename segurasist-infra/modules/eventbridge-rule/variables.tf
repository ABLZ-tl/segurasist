variable "name" {
  description = "Rule name (also used as prefix for tags / target_id)."
  type        = string
}

variable "description" {
  description = "Human-readable description displayed in EventBridge console."
  type        = string
  default     = ""
}

variable "cron_expression" {
  description = <<-EOT
    AWS schedule expression. Cron must be UTC (no TZ support in
    `aws_cloudwatch_event_rule`). Default `cron(0 14 1 * ? *)` = monthly
    on the 1st at 14:00 UTC ≈ 08:00 CST (Mexico). Adjust for DST upstream.
  EOT
  type        = string
  default     = "cron(0 14 1 * ? *)"
  validation {
    condition     = can(regex("^(rate|cron)\\(.+\\)$", var.cron_expression))
    error_message = "cron_expression must match `cron(...)` or `rate(...)`."
  }
}

variable "enabled" {
  description = "Whether the rule is ENABLED (true) or DISABLED (false). Disable in dev to avoid noisy events during refactors."
  type        = bool
  default     = true
}

variable "target_sqs_arn" {
  description = "ARN of the SQS queue target. Mutually exclusive with target_lambda_arn (one must be set)."
  type        = string
  default     = null
}

variable "target_lambda_arn" {
  description = "ARN of the Lambda function target. Mutually exclusive with target_sqs_arn."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to rule + targets."
  type        = map(string)
  default     = {}
}
