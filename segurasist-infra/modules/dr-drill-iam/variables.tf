############################################
# G-1 Sprint 5 iter 2 — DR drill OIDC runner role.
#
# Module input contract. Mantenemos las defaults alineadas con el OIDC
# provider creado por `global/iam-github-oidc/`:
#   audience = sts.amazonaws.com
#   issuer   = token.actions.githubusercontent.com
#
# Nada de credenciales hardcodeadas; el role es asumido vía
# AssumeRoleWithWebIdentity desde GH Actions con condiciones de subject.
############################################

variable "environment" {
  description = "Environment short name (e.g., staging). Forms part of the role name and trust subject."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev | staging | prod."
  }
}

variable "github_org" {
  description = "GitHub org/owner that hosts the segurasist monorepo (used in trust policy `sub` claim)."
  type        = string
  default     = "segurasist"
}

variable "github_repo" {
  description = "GitHub repository name. Trust policy restricts AssumeRoleWithWebIdentity to this repo."
  type        = string
  default     = "segurasist"
}

variable "oidc_provider_arn" {
  description = <<-EOT
    ARN del aws_iam_openid_connect_provider para GitHub Actions en este
    account. Provisionado por `global/iam-github-oidc` (output
    `github_oidc_provider_arns[var.environment]`).
  EOT
  type        = string
}

variable "allowed_branches" {
  description = <<-EOT
    Lista de refs/branches que pueden asumir el role (subject `repo:<org>/<repo>:ref:refs/heads/<branch>`).
    Default: solo `main`. PRs no pueden ejecutar drill (sería ejecución no aprobada).
  EOT
  type        = list(string)
  default     = ["main"]
}

variable "allowed_environments" {
  description = <<-EOT
    GitHub Environments que pueden asumir el role (subject `repo:<org>/<repo>:environment:<env>`).
    Default: `staging-dr` (requiere environment protection rule en GitHub
    para forzar approval del Tech Lead — RB-018 §pre-requisitos).
  EOT
  type        = list(string)
  default     = ["staging-dr"]
}

variable "rds_resource_tag_purpose" {
  description = <<-EOT
    Valor del tag `aws:ResourceTag/Purpose` requerido para que el role
    pueda invocar `rds:DeleteDBInstance`. Restringe la acción
    destructiva exclusivamente a instancias creadas por el drill (paso
    02 etiqueta el restored DB con este Purpose).
  EOT
  type        = string
  default     = "dr-drill-restore"
}

variable "cloudwatch_metric_namespace" {
  description = "Namespace permitido en `cloudwatch:PutMetricData` (RB-018 / dr-drill-alarm contract)."
  type        = string
  default     = "SegurAsist/DR"
}

variable "rds_master_secret_arns" {
  description = <<-EOT
    Lista de Secrets Manager ARNs (RDS master user secret) sobre los
    que el rol puede llamar `secretsmanager:GetSecretValue`. El workflow
    los usa en el step `Resolve RESTORED_DB_PASSWORD` para conectar
    `psql` contra la instancia restaurada.
  EOT
  type        = list(string)
  default     = []
}

variable "rds_master_secret_kms_key_arns" {
  description = "KMS keys que protegen los secrets de RDS master user (`kms:Decrypt` permission)."
  type        = list(string)
  default     = []
}

variable "extra_s3_arns" {
  description = "S3 bucket ARNs adicionales (incluye `/*`) sobre los que el rol puede leer versiones."
  type        = list(string)
  default     = []
}

variable "permissions_boundary_arn" {
  description = "Optional permissions boundary ARN attached to the role."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
