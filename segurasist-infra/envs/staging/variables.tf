variable "environment" {
  description = "Environment short name"
  type        = string
  default     = "staging"
}

variable "aws_region" {
  description = "Primary region"
  type        = string
  default     = "mx-central-1"
}

variable "aws_dr_region" {
  description = "DR region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "VPC CIDR /16"
  type        = string
  default     = "10.20.0.0/16"
}

variable "domain_name" {
  description = "Public domain"
  type        = string
  default     = "segurasist.app"
}

variable "domain_zone_id" {
  description = "Route53 hosted zone ID"
  type        = string
}

variable "github_oauth_token_secret_arn" {
  description = "Pre-existing Secrets Manager ARN with GitHub OAuth token"
  type        = string
}

variable "image_tag_api" {
  description = "ECR image tag for the API"
  type        = string
  default     = "bootstrap-placeholder"
}

variable "slack_security_webhook_secret_arn" {
  description = <<-EOT
    SecretsManager ARN with Slack webhook URL for security alerts (S5-2).
    Seedeo manual; gitignored. JSON: {"webhook_url":"https://hooks.slack.com/..."}.
  EOT
  type        = string
  default     = null
}

variable "slack_ops_webhook_url" {
  description = <<-EOT
    Slack incoming webhook URL para #ops. Lo consume el módulo
    dr-drill-alarm (RB-018 / ADR-0011) para suscribirse al SNS de
    "DR drill due". null = no se crea la subscripción.
  EOT
  type        = string
  default     = null
  sensitive   = true
}

variable "github_oidc_provider_arn" {
  description = <<-EOT
    ARN del aws_iam_openid_connect_provider para GH Actions en este
    account. Output `oidc_provider_arns["staging"]` de
    `global/iam-github-oidc`. Lo consume el módulo `dr-drill-iam` para
    crear el rol que GH Actions asume vía OIDC al ejecutar el workflow
    `dr-drill-monthly.yml` (RB-018 / ADR-0011).
  EOT
  type        = string
}

variable "github_org" {
  description = "GitHub org/owner que hostea el monorepo segurasist (trust policy del DR drill role)."
  type        = string
  default     = "segurasist"
}

variable "github_repo" {
  description = "GitHub repository name del monorepo (trust policy del DR drill role)."
  type        = string
  default     = "segurasist"
}
