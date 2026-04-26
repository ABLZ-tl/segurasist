variable "instance_arn" {
  description = "IAM Identity Center instance ARN"
  type        = string
}

variable "name" {
  description = "Permission set name (e.g., AdminFullAccess)"
  type        = string
}

variable "description" {
  description = "Permission set description"
  type        = string
}

variable "session_duration" {
  description = "Session duration ISO 8601 (e.g., PT1H, PT8H, PT12H)"
  type        = string
  default     = "PT4H"
}

variable "managed_policies" {
  description = "List of AWS managed policy ARNs to attach"
  type        = list(string)
  default     = []
}

variable "customer_managed_policies" {
  description = "List of customer-managed policy names + path"
  type = list(object({
    name = string
    path = optional(string, "/")
  }))
  default = []
}

variable "inline_policy" {
  description = "Optional inline JSON policy document"
  type        = string
  default     = null
}

variable "permissions_boundary" {
  description = "Optional permissions boundary"
  type = object({
    managed_policy_arn  = optional(string, null)
    customer_managed    = optional(object({ name = string, path = optional(string, "/") }), null)
  })
  default = null
}

variable "account_assignments" {
  description = "List of {account_id, principal_id, principal_type=USER|GROUP}"
  type = list(object({
    account_id     = string
    principal_id   = string
    principal_type = string
  }))
  default = []
}

variable "tags" {
  description = "Tags applied to permission set"
  type        = map(string)
  default     = {}
}
