variable "bucket_name" {
  description = "Name del bucket S3 (e.g. `segurasist-tenant-branding-{env}`)"
  type        = string
}

variable "force_destroy" {
  description = "Permite destruir el bucket aunque tenga objetos (sólo dev/staging)"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags por defecto"
  type        = map(string)
  default     = {}
}

variable "cors_allowed_origins" {
  description = "Lista de orígenes que pueden hacer requests al bucket via S3 CORS (admin/portal). [] desactiva CORS."
  type        = list(string)
  default     = []
}

variable "price_class" {
  description = "CloudFront price class. Default `PriceClass_100` (NA + EU). Para Mx-only puede bajarse."
  type        = string
  default     = "PriceClass_100"
}

variable "aliases" {
  description = "CNAMEs alternativos para el CDN (e.g. `branding-cdn.segurasist.app`). [] = usa el dominio cloudfront default."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "ARN del cert ACM us-east-1 que CloudFront usará. NULL → usa el cert default *.cloudfront.net."
  type        = string
  default     = null
}
