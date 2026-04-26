variable "github_org" {
  description = "GitHub organization name (sub claim prefix)"
  type        = string
  default     = "segurasist"
}

variable "account_ids" {
  description = "Map of env -> AWS account ID"
  type = object({
    dev     = string
    staging = string
    prod    = string
  })
}

variable "infra_repo" {
  description = "Infra repo name"
  type        = string
  default     = "segurasist-infra"
}

variable "api_repo" {
  description = "API repo name"
  type        = string
  default     = "segurasist-api"
}

variable "web_repo" {
  description = "Web repo name"
  type        = string
  default     = "segurasist-web"
}

variable "permissions_boundary_arn" {
  description = "Optional permissions boundary ARN to attach to all OIDC roles"
  type        = string
  default     = null
}
