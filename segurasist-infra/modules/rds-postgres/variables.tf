variable "identifier" {
  description = "DB instance identifier (e.g., segurasist-prod-rds-main)"
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "16.3"
}

variable "instance_class" {
  description = "DB instance class"
  type        = string
  default     = "db.t4g.small"
}

variable "allocated_storage" {
  description = "Initial GiB"
  type        = number
  default     = 50
}

variable "max_allocated_storage" {
  description = "Storage autoscaling cap GiB"
  type        = number
  default     = 500
}

variable "storage_type" {
  description = "Storage type (gp3 recommended)"
  type        = string
  default     = "gp3"
}

variable "multi_az" {
  description = "Multi-AZ deployment"
  type        = bool
  default     = true
}

variable "storage_encrypted" {
  description = "Encrypt storage at rest. Always true."
  type        = bool
  default     = true
}

variable "kms_key_id" {
  description = "KMS CMK ARN for storage encryption"
  type        = string
}

variable "performance_insights_enabled" {
  description = "Enable Performance Insights"
  type        = bool
  default     = true
}

variable "performance_insights_kms_key_id" {
  description = "Optional KMS CMK ARN for PI; defaults to storage CMK if null"
  type        = string
  default     = null
}

variable "performance_insights_retention_period" {
  description = "PI retention days (7, 731)"
  type        = number
  default     = 7
}

variable "monitoring_interval" {
  description = "Enhanced monitoring interval seconds (0,1,5,10,15,30,60)"
  type        = number
  default     = 60
}

variable "backup_retention_period" {
  description = "Backup retention days"
  type        = number
  default     = 7
}

variable "backup_window" {
  description = "Daily backup window UTC"
  type        = string
  default     = "08:00-08:30"
}

variable "maintenance_window" {
  description = "Weekly maintenance window UTC"
  type        = string
  default     = "sun:09:00-sun:09:30"
}

variable "deletion_protection" {
  description = "Prevent destroy"
  type        = bool
  default     = true
}

variable "copy_tags_to_snapshot" {
  description = "Copy tags to snapshots"
  type        = bool
  default     = true
}

variable "skip_final_snapshot" {
  description = "Skip snapshot on destroy. Should be false in prod."
  type        = bool
  default     = false
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs (private-data) for DB subnet group"
  type        = list(string)
}

variable "allowed_sg_ids" {
  description = "Security group IDs allowed inbound on 5432"
  type        = list(string)
  default     = []
}

variable "parameter_group" {
  description = "Custom parameter group: family + parameters"
  type = object({
    family = string
    parameters = list(object({
      name         = string
      value        = string
      apply_method = optional(string, "immediate")
    }))
  })
  default = {
    family = "postgres16"
    parameters = [
      { name = "shared_preload_libraries", value = "pg_stat_statements,pgaudit", apply_method = "pending-reboot" },
      { name = "pgaudit.log", value = "ddl,role,write", apply_method = "immediate" },
      { name = "rds.force_ssl", value = "1", apply_method = "immediate" },
      { name = "log_min_duration_statement", value = "1000", apply_method = "immediate" },
    ]
  }
}

variable "master_username" {
  description = "Master username"
  type        = string
  default     = "segurasist_admin"
}

variable "manage_master_user_password" {
  description = "Use Secrets Manager managed master password"
  type        = bool
  default     = true
}

variable "master_user_secret_kms_key_id" {
  description = "KMS CMK ARN for managed master user secret"
  type        = string
  default     = null
}

variable "cross_region_replica" {
  description = "Optional read replica in another region"
  type = object({
    enabled     = bool
    region      = string
    kms_key_arn = string
  })
  default = {
    enabled     = false
    region      = ""
    kms_key_arn = ""
  }
}

variable "auto_minor_version_upgrade" {
  description = "Allow automatic minor version upgrades"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default     = {}
}
