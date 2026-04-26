variable "domain_name" {
  description = "Public apex domain"
  type        = string
  default     = "segurasist.app"
}

variable "additional_subject_alternative_names" {
  description = "Extra SANs for the wildcard cert"
  type        = list(string)
  default     = []
}

variable "health_check_targets" {
  description = "Map name -> { fqdn, port, type, path }"
  type = map(object({
    fqdn = string
    port = optional(number, 443)
    type = optional(string, "HTTPS")
    path = optional(string, "/health/live")
  }))
  default = {}
}
