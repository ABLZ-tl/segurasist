variable "alias" {
  description = "KMS alias (without 'alias/' prefix). Will be prefixed with 'alias/'."
  type        = string
}

variable "description" {
  description = "Human-readable description of the key"
  type        = string
}

variable "key_usage" {
  description = "ENCRYPT_DECRYPT or SIGN_VERIFY"
  type        = string
  default     = "ENCRYPT_DECRYPT"
}

variable "customer_master_key_spec" {
  description = "SYMMETRIC_DEFAULT, RSA_*, ECC_*"
  type        = string
  default     = "SYMMETRIC_DEFAULT"
}

variable "deletion_window_in_days" {
  description = "Pending deletion window (7-30)"
  type        = number
  default     = 30
}

variable "enable_key_rotation" {
  description = "Enable annual key rotation"
  type        = bool
  default     = true
}

variable "multi_region" {
  description = "Create as multi-region KMS key (for cross-region replication scenarios)"
  type        = bool
  default     = false
}

variable "additional_principals" {
  description = "Extra IAM principals (ARNs) granted Encrypt/Decrypt"
  type        = list(string)
  default     = []
}

variable "service_principals" {
  description = "AWS service principals granted Encrypt/Decrypt (e.g. logs.amazonaws.com)"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to the key + alias"
  type        = map(string)
  default     = {}
}
