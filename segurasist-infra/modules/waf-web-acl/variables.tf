variable "name" {
  description = "WAF Web ACL name"
  type        = string
}

variable "scope" {
  description = "REGIONAL (ALB / App Runner) or CLOUDFRONT"
  type        = string
  default     = "REGIONAL"
  validation {
    condition     = contains(["REGIONAL", "CLOUDFRONT"], var.scope)
    error_message = "scope must be REGIONAL or CLOUDFRONT."
  }
}

variable "rate_limit_per_5min" {
  description = "Rate-based rule threshold per IP per 5 minutes (default 500 = 100 req/min)"
  type        = number
  default     = 500
}

variable "managed_rule_groups" {
  description = "AWS managed rule groups to enable (priority assigned in order)"
  type        = list(string)
  default = [
    "AWSManagedRulesCommonRuleSet",
    "AWSManagedRulesKnownBadInputsRuleSet",
    "AWSManagedRulesSQLiRuleSet",
    "AWSManagedRulesAmazonIpReputationList",
    "AWSManagedRulesAnonymousIpList",
  ]
}

variable "log_destination_arn" {
  description = "ARN of CloudWatch Log Group OR Kinesis Firehose for WAF logs"
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to the Web ACL"
  type        = map(string)
  default     = {}
}
