variable "zone_id" {
  description = "Route53 hosted zone ID"
  type        = string
}

variable "name" {
  description = "Record name (FQDN or relative to zone)"
  type        = string
}

variable "type" {
  description = "Record type: A | AAAA | CNAME | TXT | MX | etc."
  type        = string
}

variable "ttl" {
  description = "TTL seconds (ignored when alias is set)"
  type        = number
  default     = 300
}

variable "records" {
  description = "Resource records for non-alias records"
  type        = list(string)
  default     = []
}

variable "alias" {
  description = "Alias config (mutually exclusive with records/ttl)"
  type = object({
    name                   = string
    zone_id                = string
    evaluate_target_health = optional(bool, false)
  })
  default = null
}

variable "set_identifier" {
  description = "Routing policy identifier (for weighted/failover/etc.)"
  type        = string
  default     = null
}

variable "health_check_id" {
  description = "Optional health check ID"
  type        = string
  default     = null
}
