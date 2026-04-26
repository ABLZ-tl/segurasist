variable "name" {
  description = "Amplify app name"
  type        = string
}

variable "repository" {
  description = "GitHub repository URL (https://github.com/org/repo)"
  type        = string
}

variable "platform" {
  description = "WEB | WEB_COMPUTE | WEB_DYNAMIC"
  type        = string
  default     = "WEB_COMPUTE"
}

variable "build_spec" {
  description = "amplify.yml build spec content (heredoc string). Null defers to repo amplify.yml."
  type        = string
  default     = null
}

variable "github_oauth_token_secret_arn" {
  description = "Secrets Manager secret ARN containing GitHub OAuth/PAT token (json key=token)"
  type        = string
}

variable "iam_service_role_arn" {
  description = "Optional service role ARN (SSR functions, custom build)"
  type        = string
  default     = null
}

variable "environment_variables" {
  description = "Map of build-time env vars"
  type        = map(string)
  default     = {}
}

variable "branches" {
  description = "Branches to track. Map name -> config"
  type = map(object({
    stage                   = optional(string, "PRODUCTION") # PRODUCTION | BETA | DEVELOPMENT
    framework               = optional(string, "Next.js - SSR")
    enable_auto_build       = optional(bool, true)
    enable_pull_request_preview = optional(bool, false)
    environment_variables   = optional(map(string), {})
  }))
  default = {}
}

variable "custom_domain" {
  description = "Optional custom domain config"
  type = object({
    domain_name      = string
    sub_domains      = list(object({
      branch_name = string
      prefix      = string
    }))
    wait_for_verification = optional(bool, false)
  })
  default = null
}

variable "enable_basic_auth" {
  description = "Enable basic auth on the entire app (preview / staging gating)"
  type        = bool
  default     = false
}

variable "basic_auth_credentials" {
  description = "Base64-encoded basic auth credentials"
  type        = string
  default     = null
  sensitive   = true
}

variable "custom_rules" {
  description = "Custom redirect/rewrite rules"
  type = list(object({
    source = string
    target = string
    status = string
    condition = optional(string, null)
  }))
  default = [
    {
      source = "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>"
      target = "/index.html"
      status = "200"
    }
  ]
}

variable "tags" {
  description = "Tags applied to app"
  type        = map(string)
  default     = {}
}
