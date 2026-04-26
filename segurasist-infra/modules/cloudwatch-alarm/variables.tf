variable "name" {
  description = "Alarm name"
  type        = string
}

variable "description" {
  description = "Alarm description"
  type        = string
  default     = ""
}

variable "metric_name" {
  description = "CloudWatch metric name"
  type        = string
}

variable "namespace" {
  description = "CloudWatch namespace (e.g., AWS/RDS)"
  type        = string
}

variable "dimensions" {
  description = "Metric dimensions"
  type        = map(string)
  default     = {}
}

variable "statistic" {
  description = "Statistic (SampleCount, Average, Sum, Min, Max)"
  type        = string
  default     = "Average"
}

variable "extended_statistic" {
  description = "Percentile (e.g., p95). Mutually exclusive with statistic."
  type        = string
  default     = null
}

variable "period_seconds" {
  description = "Period seconds (>=10)"
  type        = number
  default     = 60
}

variable "evaluation_periods" {
  description = "Number of periods for evaluation"
  type        = number
  default     = 5
}

variable "datapoints_to_alarm" {
  description = "Datapoints to alarm (within evaluation_periods)"
  type        = number
  default     = 3
}

variable "comparison_operator" {
  description = "Comparison operator"
  type        = string
  default     = "GreaterThanThreshold"
}

variable "threshold" {
  description = "Threshold value"
  type        = number
}

variable "treat_missing_data" {
  description = "missing | breaching | notBreaching | ignore"
  type        = string
  default     = "missing"
}

variable "sns_topic_arn" {
  description = "SNS topic ARN for alarm + ok actions"
  type        = string
}

variable "actions_enabled" {
  description = "Whether alarm actions are enabled"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to the alarm"
  type        = map(string)
  default     = {}
}
