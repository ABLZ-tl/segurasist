############################################
# WAFv2 Web ACL — variables (S3-10 hardening)
############################################

variable "name" {
  description = "WAF Web ACL name (típicamente segurasist-<env>-<scope_name>)"
  type        = string
}

variable "scope" {
  description = "REGIONAL (App Runner / ALB en mx-central-1) o CLOUDFRONT (Amplify Hosting; debe instanciarse con provider us-east-1)"
  type        = string
  default     = "REGIONAL"
  validation {
    condition     = contains(["REGIONAL", "CLOUDFRONT"], var.scope)
    error_message = "scope must be REGIONAL or CLOUDFRONT."
  }
}

variable "rate_limit_per_5min" {
  description = "Threshold de la rule rate-based por IP, evaluado en una ventana FIJA de 5 minutos (mínimo de WAFv2). 500 ≈ 100 req/min/IP. Subí a 2000+ para endpoints API legítimamente bursty (uploads de batches con polling)."
  type        = number
  default     = 500
}

variable "rate_limit_per_ip" {
  description = "Alias semántico (req/min) — convertido a la ventana de 5min interna. Si se especifica !=null sobrescribe rate_limit_per_5min."
  type        = number
  default     = null
}

variable "managed_rule_groups" {
  description = "AWS managed rule groups en orden de prioridad. El default cubre RNF-SEC-05 (audit Sprint 1)."
  type        = list(string)
  default = [
    "AWSManagedRulesCommonRuleSet",
    "AWSManagedRulesKnownBadInputsRuleSet",
    "AWSManagedRulesSQLiRuleSet",
    "AWSManagedRulesAmazonIpReputationList",
    "AWSManagedRulesAnonymousIpList",
  ]
}

variable "anonymous_ip_action" {
  description = "Acción para AnonymousIpList (Tor / hosting / VPN comerciales). 'count' (default) sólo registra; 'block' rechaza. Mantener en 'count' hasta validación CISO con muestra de tráfico (audit Sprint 1: muchos hospitales usan VPN corporativa que cae en este rule group)."
  type        = string
  default     = "count"
  validation {
    condition     = contains(["count", "block"], var.anonymous_ip_action)
    error_message = "anonymous_ip_action must be 'count' or 'block'."
  }
}

variable "log_destination_arn" {
  description = "ARN de Kinesis Firehose Delivery Stream o CloudWatch Log Group (debe empezar con 'aws-waf-logs-'). null deshabilita logging."
  type        = string
  default     = null
}

variable "log_retention_days" {
  description = "Reservado: lo aplica el caller cuando crea el Log Group. Documentado aquí para que el README quede consistente con la regla de 90 días por defecto (operacional) / 365 días (auditoría)."
  type        = number
  default     = 90
}

variable "redacted_header_names" {
  description = "Headers que se redactan en los WAF logs antes de salir a Firehose/CW. authorization + cookie por default; agregá 'x-api-key' u otros si hay clientes M2M."
  type        = list(string)
  default     = ["authorization", "cookie"]
}

variable "tags" {
  description = "Tags aplicados al Web ACL (los tags por default del provider se mergean automáticamente)"
  type        = map(string)
  default     = {}
}
