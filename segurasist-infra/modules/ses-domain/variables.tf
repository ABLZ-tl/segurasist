variable "domain" {
  description = "Domain name to verify (e.g., segurasist.app)"
  type        = string
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for DNS records"
  type        = string
}

variable "mail_from_subdomain" {
  description = "MAIL FROM subdomain prefix (creates {prefix}.{domain})"
  type        = string
  default     = "bounce"
}

variable "dmarc_policy" {
  description = "DMARC policy: none | quarantine | reject"
  type        = string
  default     = "quarantine"
}

variable "dmarc_rua" {
  description = "DMARC reporting address"
  type        = string
  default     = null
}

variable "configuration_set_name" {
  description = "Configuration set name"
  type        = string
}

variable "tls_policy" {
  description = "Require | Optional"
  type        = string
  default     = "REQUIRE"
}

variable "reputation_metrics_enabled" {
  description = "Publish reputation metrics to CloudWatch"
  type        = bool
  default     = true
}

variable "sns_topic_arn" {
  description = "SNS topic ARN to receive bounce/complaint/delivery events"
  type        = string
}

variable "event_types" {
  description = "Event types delivered to SNS"
  type        = list(string)
  default     = ["bounce", "complaint", "delivery", "reject", "renderingFailure"]
}

variable "tags" {
  description = "Tags applied to resources"
  type        = map(string)
  default     = {}
}
