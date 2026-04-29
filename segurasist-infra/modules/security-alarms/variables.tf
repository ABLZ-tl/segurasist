############################################
# S5-2 — Security Alarms module.
#
# Wires GuardDuty + Security Hub findings into:
#   1. SNS topic `security-alerts-<env>` (KMS-encrypted).
#   2. Slack webhook subscription via SecretsManager-stored URL.
#   3. EventBridge rule: GuardDuty severity HIGH/CRITICAL → SNS.
#   4. CloudWatch alarm: SecurityHub failed compliance count.
#   5. Optional auto-quarantine Lambda for `Backdoor:EC2/...` findings.
#
# Slack webhook URL MUST come from SecretsManager (var.slack_webhook_secret_arn).
# Hardcoding webhooks in tfvars violates the secrets policy (verified
# in `segurasist-infra/.gitignore` excludes `*.tfvars`).
############################################

variable "environment" {
  description = "Environment short name (dev/staging/prod)."
  type        = string
}

variable "name_prefix" {
  description = "Resource name prefix (segurasist-<env>)."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS CMK ARN used for SNS topic SSE. Reuse env general key — anti-pattern crear key dedicada."
  type        = string
}

variable "slack_webhook_secret_arn" {
  description = <<-EOT
    SecretsManager secret ARN containing the Slack webhook URL under JSON
    key `webhook_url`. The Lambda forwarder reads it at runtime; the URL
    is NEVER plain in tfvars. Set null to skip Slack subscription.
  EOT
  type        = string
  default     = null
}

variable "severity_alert_threshold" {
  description = <<-EOT
    GuardDuty severity threshold (numeric scale 0.1 - 8.9). Findings at
    or above this severity trigger SNS publication. ADR-0010: 7.0 (HIGH).
    Findings between [4.0, 7.0) generate tickets via separate workflow
    (S5-3 issue tracker integration), not pages.
  EOT
  type        = number
  default     = 7.0
}

variable "securityhub_failed_threshold" {
  description = "Number of failed Security Hub compliance findings in 1h to trigger alarm."
  type        = number
  default     = 5
}

variable "enable_auto_quarantine" {
  description = <<-EOT
    Provision a Lambda that tags EC2 instances with sg-quarantine when
    a `Backdoor:EC2/...` GuardDuty finding fires. Default false in dev,
    enable explicitly in staging/prod after canary.
  EOT
  type        = bool
  default     = false
}

variable "quarantine_security_group_id" {
  description = "Security group id applied to quarantined EC2 instances. Required when enable_auto_quarantine = true."
  type        = string
  default     = null
}

variable "vpc_subnet_ids" {
  description = "Subnet ids for the quarantine Lambda VPC config (reuse private app subnets). Required when enable_auto_quarantine = true."
  type        = list(string)
  default     = []
}

variable "vpc_security_group_ids" {
  description = "Security group ids for the quarantine Lambda VPC config."
  type        = list(string)
  default     = []
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the Slack forwarder + quarantine Lambdas."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
