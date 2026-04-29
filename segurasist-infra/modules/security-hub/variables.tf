############################################
# S5-2 — Security Hub per-env module.
#
# Same layered design as guardduty/: org-level module already enabled
# Security Hub with auto-enable per member account. This module
# subscribes the env-account to additional standards (CIS v1.4.0,
# AWS FSBP, optional PCI DSS) and disables controls that don't apply
# to SegurAsist (no EKS, no AppMesh, no IoT — see ADR-0010).
############################################

variable "environment" {
  description = "Environment short name (dev/staging/prod)."
  type        = string
}

variable "name_prefix" {
  description = "Resource name prefix (segurasist-<env>)."
  type        = string
}

variable "create_account_subscription" {
  description = <<-EOT
    Whether this module enables Security Hub on the account. Set false
    when the org-level module already auto-enabled the member; true
    only for standalone bootstrap.
  EOT
  type        = bool
  default     = false
}

variable "enable_default_standards" {
  description = "Enable AWS-managed default standards on creation. Effective only when create_account_subscription = true."
  type        = bool
  default     = false
}

variable "enable_aws_foundational" {
  description = "Subscribe AWS Foundational Security Best Practices v1.0.0."
  type        = bool
  default     = true
}

variable "enable_cis_v1_4_0" {
  description = "Subscribe CIS AWS Foundations Benchmark v1.4.0."
  type        = bool
  default     = true
}

variable "enable_pci_dss" {
  description = <<-EOT
    Subscribe PCI DSS v3.2.1. SegurAsist NO procesa pagos directamente
    (Hospitales MAC factura por separado; el portal solo emite
    constancias). Default false. Cambiar a true sólo si el modelo de
    negocio incluye captura de PAN/CVV. Ver ADR-0010.
  EOT
  type        = bool
  default     = false
}

variable "enable_nist_800_53" {
  description = "Subscribe NIST SP 800-53 Rev. 5. Útil si hay clientes federales US (no es el caso MVP). Default false."
  type        = bool
  default     = false
}

variable "auto_disabled_controls" {
  description = <<-EOT
    Lista de control IDs (formato `<standard-short>:<control-id>`, e.g.
    `aws-foundational:EKS.1`) que se auto-desactivan con razón
    documentada. Standard-short = `aws-foundational` | `cis-v1.4.0` |
    `pci-dss` | `nist-800-53`. La razón se persiste en el control
    `disabled_reason` del control. Ver ADR-0010 para la justificación
    canónica.
  EOT
  type = list(object({
    standard       = string
    control_id     = string
    reason         = string
  }))
  default = []
}

variable "enable_aggregator" {
  description = "Enable cross-region finding aggregator. Iter 1: false (solo mx-central-1). Activar cuando se introduzca arch multi-región."
  type        = bool
  default     = false
}

variable "aggregator_linking_mode" {
  description = "ALL_REGIONS | ALL_REGIONS_EXCEPT_SPECIFIED | SPECIFIED_REGIONS."
  type        = string
  default     = "ALL_REGIONS"
}

variable "aggregator_specified_regions" {
  description = "Regions list when linking_mode != ALL_REGIONS."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
