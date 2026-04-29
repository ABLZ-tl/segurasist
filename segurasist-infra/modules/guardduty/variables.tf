############################################
# S5-2 — GuardDuty per-env module.
#
# IMPORTANT: GuardDuty at the ORG level is already enabled in
# `segurasist-infra/global/security/main.tf` (delegated admin =
# security account, auto-enable members). This per-env module is
# additive: it provides env-scoped finding export to S3, optional
# trusted-IP lists, and ensures protection plans match the env
# (S3 / Malware / RDS). For greenfield AWS accounts where the org
# module has not yet run, set `create_detector = true` so the module
# bootstraps a detector locally.
############################################

variable "environment" {
  description = "Environment short name (dev/staging/prod). Used in resource names + tags."
  type        = string
}

variable "name_prefix" {
  description = "Resource name prefix (e.g. segurasist-dev). Matches envs/<env>/main.tf locals.name_prefix."
  type        = string
}

variable "create_detector" {
  description = <<-EOT
    Whether this module creates the GuardDuty detector. Set false when the
    detector is already managed by the org-level module (default for
    member accounts). Set true ONLY when the env account is standalone
    (e.g. early dev sandbox before org delegation).
  EOT
  type        = bool
  default     = false
}

variable "enable_findings_publishing" {
  description = "Publish findings to S3 (export). Default true; disable only if duplicate of a centralised export."
  type        = bool
  default     = true
}

variable "finding_publishing_frequency" {
  description = "FIFTEEN_MINUTES | ONE_HOUR | SIX_HOURS. Tighter freq increases EventBridge volume."
  type        = string
  default     = "FIFTEEN_MINUTES"
  validation {
    condition     = contains(["FIFTEEN_MINUTES", "ONE_HOUR", "SIX_HOURS"], var.finding_publishing_frequency)
    error_message = "finding_publishing_frequency must be FIFTEEN_MINUTES, ONE_HOUR, or SIX_HOURS."
  }
}

variable "enable_s3_protection" {
  description = "Enable S3 data event protection."
  type        = bool
  default     = true
}

variable "enable_eks_protection" {
  description = "Enable EKS audit logs + runtime protection. SegurAsist no usa EKS hoy → default false (override true cuando aterrice EKS)."
  type        = bool
  default     = false
}

variable "enable_malware_protection" {
  description = "Enable Malware Protection (EBS volume scanning on suspicious findings)."
  type        = bool
  default     = true
}

variable "enable_rds_protection" {
  description = "Enable RDS Login Events protection (audit attempts to RDS Aurora/Postgres)."
  type        = bool
  default     = true
}

variable "enable_lambda_protection" {
  description = "Enable Lambda Network Activity protection."
  type        = bool
  default     = true
}

variable "kms_key_arn" {
  description = "KMS CMK ARN used for the findings export S3 bucket. Reuse the env general or audit CMK — DO NOT create a per-module key."
  type        = string
}

variable "findings_bucket_name" {
  description = <<-EOT
    Optional override of the findings export bucket name. Default
    `segurasist-security-findings-<env>-<account_id>`. Globally unique
    requirement of S3 enforced by appending account id.
  EOT
  type        = string
  default     = null
}

variable "findings_retention_days" {
  description = "Days to keep findings in S3 STANDARD before transitioning to GLACIER. ADR-0010: 90."
  type        = number
  default     = 90
  validation {
    condition     = var.findings_retention_days >= 30
    error_message = "findings_retention_days must be >= 30 (S3 minimum for transition to IA / GLACIER)."
  }
}

variable "findings_glacier_after_days" {
  description = "Days at which findings transition to GLACIER. ADR-0010: 90 (= retention_days). Total findings life-time cap: 730 days."
  type        = number
  default     = 90
}

variable "findings_total_expiration_days" {
  description = "Hard expiration after which findings objects are deleted. Default 730 (2 years) — match audit S3 cap."
  type        = number
  default     = 730
}

variable "trusted_ip_lists" {
  description = <<-EOT
    Optional list of trusted-IP threat lists. Each entry uploads a
    plain-text file (one CIDR per line) to the findings bucket and
    registers it as an `aws_guardduty_ipset`. Use sparingly — broad
    trusted lists weaken detection. Example:
    [{ name = "office-egress", cidrs = ["203.0.113.0/24"] }]
  EOT
  type = list(object({
    name  = string
    cidrs = list(string)
  }))
  default = []
}

variable "threat_intel_lists" {
  description = "Optional malicious-IP threat intel lists (same shape as trusted_ip_lists; registered as aws_guardduty_threatintelset)."
  type = list(object({
    name  = string
    cidrs = list(string)
  }))
  default = []
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
