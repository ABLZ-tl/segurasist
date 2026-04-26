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
