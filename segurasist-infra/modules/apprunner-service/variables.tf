variable "service_name" {
  description = "App Runner service name (e.g., segurasist-prod-api)"
  type        = string
}

variable "image_uri" {
  description = "ECR image URI with tag (e.g., 123.dkr.ecr.mx-central-1.amazonaws.com/segurasist-api:abc123)"
  type        = string
}

variable "image_repository_type" {
  description = "ECR or ECR_PUBLIC"
  type        = string
  default     = "ECR"
}

variable "ecr_repository_arn" {
  description = "ARN of the ECR repository (required for ECR access role)"
  type        = string
}

variable "cpu" {
  description = "CPU units (e.g., 1024 = 1 vCPU)"
  type        = string
  default     = "1024"
}

variable "memory" {
  description = "Memory in MB"
  type        = string
  default     = "2048"
}

variable "port" {
  description = "Container port"
  type        = number
  default     = 3000
}

variable "health_check" {
  description = "Health check config"
  type = object({
    path                = optional(string, "/health/ready")
    protocol            = optional(string, "HTTP")
    interval            = optional(number, 10)
    timeout             = optional(number, 5)
    healthy_threshold   = optional(number, 2)
    unhealthy_threshold = optional(number, 3)
  })
  default = {}
}

variable "auto_scaling" {
  description = "Auto-scaling config"
  type = object({
    min_size        = optional(number, 1)
    max_size        = optional(number, 10)
    max_concurrency = optional(number, 100)
  })
  default = {}
}

variable "vpc_connector_arn" {
  description = "ARN of an App Runner VPC connector (private egress)"
  type        = string
}

variable "observability_enabled" {
  description = "Enable App Runner observability (X-Ray)"
  type        = bool
  default     = true
}

variable "env_vars" {
  description = "Plain environment variables"
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Map of env var name -> Secrets Manager / SSM Parameter ARN"
  type        = map(string)
  default     = {}
}

variable "kms_key_arn" {
  description = "KMS CMK ARN for App Runner encryption"
  type        = string
}

variable "waf_web_acl_arn" {
  description = "Optional WAFv2 Web ACL ARN to associate"
  type        = string
  default     = null
}

variable "auto_deployments_enabled" {
  description = "Enable auto-deploys on ECR push"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}
