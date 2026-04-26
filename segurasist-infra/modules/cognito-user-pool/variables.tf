variable "name" {
  description = "User pool name (e.g., segurasist-prod-admin)"
  type        = string
}

variable "pool_kind" {
  description = "admin (MFA hard, WebAuthn/TOTP) or insured (OTP email/SMS, MFA opt-in)"
  type        = string
  default     = "admin"
  validation {
    condition     = contains(["admin", "insured"], var.pool_kind)
    error_message = "pool_kind must be 'admin' or 'insured'."
  }
}

variable "domain_prefix" {
  description = "Hosted UI domain prefix (.auth.mx-central-1.amazoncognito.com). Null to skip domain."
  type        = string
  default     = null
}

variable "custom_domain" {
  description = "Optional ACM-fronted custom domain (must own zone)"
  type = object({
    domain          = string
    acm_certificate = string
  })
  default = null
}

variable "deletion_protection" {
  description = "Prevent accidental pool deletion"
  type        = string
  default     = "ACTIVE"
}

variable "password_policy" {
  description = "Password policy"
  type = object({
    minimum_length    = optional(number, 12)
    require_lowercase = optional(bool, true)
    require_uppercase = optional(bool, true)
    require_numbers   = optional(bool, true)
    require_symbols   = optional(bool, true)
    temporary_password_validity_days = optional(number, 3)
  })
  default = {}
}

variable "advanced_security_mode" {
  description = "OFF | AUDIT | ENFORCED (Cognito Advanced Security)"
  type        = string
  default     = "ENFORCED"
}

variable "groups" {
  description = "Cognito groups to create (name -> description)"
  type        = map(string)
  default     = {}
}

variable "resource_servers" {
  description = "OAuth2 resource servers: identifier -> { name, scopes = [{name,description}] }"
  type = map(object({
    name = string
    scopes = list(object({
      name        = string
      description = string
    }))
  }))
  default = {}
}

variable "app_clients" {
  description = "App clients: name -> config"
  type = map(object({
    generate_secret                      = optional(bool, false)
    callback_urls                        = optional(list(string), [])
    logout_urls                          = optional(list(string), [])
    allowed_oauth_flows                  = optional(list(string), ["code"])
    allowed_oauth_scopes                 = optional(list(string), ["openid", "email", "profile"])
    allowed_oauth_flows_user_pool_client = optional(bool, true)
    explicit_auth_flows                  = optional(list(string), ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"])
    supported_identity_providers         = optional(list(string), ["COGNITO"])
    access_token_validity_minutes        = optional(number, 60)
    id_token_validity_minutes            = optional(number, 60)
    refresh_token_validity_days          = optional(number, 30)
    prevent_user_existence_errors        = optional(bool, true)
  }))
  default = {}
}

variable "saml_providers" {
  description = "SAML identity providers: name -> { metadata_url OR metadata_file }"
  type = map(object({
    metadata_url    = optional(string, null)
    metadata_file   = optional(string, null)
    attribute_email = optional(string, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")
  }))
  default = {}
}

variable "oidc_providers" {
  description = "OIDC identity providers: name -> { client_id, client_secret, issuer, authorize_scopes }"
  type = map(object({
    client_id        = string
    client_secret    = string
    issuer           = string
    authorize_scopes = optional(string, "openid email profile")
  }))
  default = {}
  sensitive = true
}

variable "ses_source_email_arn" {
  description = "SES verified identity ARN to use for transactional Cognito emails"
  type        = string
  default     = null
}

variable "ses_reply_to_address" {
  description = "Reply-to email"
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to user pool"
  type        = map(string)
  default     = {}
}
