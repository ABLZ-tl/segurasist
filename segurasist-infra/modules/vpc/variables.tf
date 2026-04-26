variable "name_prefix" {
  description = "Naming prefix, e.g. segurasist-prod"
  type        = string
}

variable "cidr_block" {
  description = "CIDR /16 of the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "List of 3 AZ names (e.g. [\"mx-central-1a\",\"mx-central-1b\",\"mx-central-1c\"])"
  type        = list(string)
  validation {
    condition     = length(var.azs) == 3
    error_message = "Exactly 3 AZs are required."
  }
}

variable "public_subnet_cidrs" {
  description = "Map AZ -> CIDR for public subnets"
  type        = map(string)
}

variable "private_app_subnet_cidrs" {
  description = "Map AZ -> CIDR for private-app subnets"
  type        = map(string)
}

variable "private_data_subnet_cidrs" {
  description = "Map AZ -> CIDR for private-data subnets"
  type        = map(string)
}

variable "enable_nat_high_availability" {
  description = "If true, deploys 1 NAT Gateway per AZ. If false, single NAT Gateway (cheaper, lower availability)."
  type        = bool
  default     = false
}

variable "enable_flow_logs" {
  description = "Enable VPC flow logs to CloudWatch Logs"
  type        = bool
  default     = true
}

variable "flow_logs_retention_days" {
  description = "Retention in days for VPC flow logs"
  type        = number
  default     = 90
}

variable "interface_endpoints" {
  description = "List of interface VPC endpoint service names (without com.amazonaws prefix)"
  type        = list(string)
  default = [
    "kms",
    "secretsmanager",
    "sqs",
    "email-smtp",
    "ecr.api",
    "ecr.dkr",
    "logs",
    "events",
    "cognito-idp",
  ]
}

variable "tags" {
  description = "Additional tags merged into all resources"
  type        = map(string)
  default     = {}
}
