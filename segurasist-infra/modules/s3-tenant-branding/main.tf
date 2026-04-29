# Sprint 5 — MT-1. Bucket S3 + CloudFront para assets de branding por tenant.
#
# Objetivo: servir logos / bg images de los tenants a los portales de los
# asegurados con baja latencia (CDN) y sin exponer el bucket público
# directamente. La distribución CloudFront usa Origin Access Identity (OAI)
# para autenticar contra el bucket privado; clientes externos nunca pueden
# leer del bucket S3 por su URL S3 (BlockPublicAccess está set).
#
# Decisiones:
#   - Bucket privado (BlockPublicAccess=true) — el frontend consume vía
#     `https://{cdn_domain}/{tenantId}/logo-*.{ext}`.
#   - SSE-S3 (AES256) — los logos NO son PII; SSE-KMS introduce costo y
#     latency de KMS Decrypt en cada request del CDN, sin valor adicional.
#   - Versioning enabled — permite "rollback de branding" cuando un admin
#     sube un logo equivocado y quiere restaurar el anterior.
#   - Cache TTL 3600s en CloudFront — alineado con el header
#     `Cache-Control: public, max-age=3600` que el API setea al hacer
#     PutObject. Cuando se sube un logo nuevo el path cambia (timestamp en
#     el key), por lo que NO necesitamos invalidations manuales.
#   - CORS abierto a los dominios permitidos (var.cors_allowed_origins) —
#     el portal/admin lo consume via `<img src=...>` (no necesita CORS) pero
#     el editor admin puede hacer `fetch(...)` para previews al subir.
#   - WAF NO se asocia en iter 1 (los assets son públicos via OAI; no hay
#     superficie de inyección). Iter 2 considerar agregar el WAF v2 que
#     ya gestiona `segurasist-infra/modules/waf-web-acl`.

terraform {
  required_version = ">= 1.7.0, < 2.0.0"

  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.40"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

############################################
# Bucket
############################################

resource "aws_s3_bucket" "this" {
  bucket        = var.bucket_name
  force_destroy = var.force_destroy

  tags = merge(var.tags, { Name = var.bucket_name, Component = "tenant-branding" })
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    # `Enabled` permite restore de logo previo si admin sube uno equivocado.
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "this" {
  count  = length(var.cors_allowed_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.this.id

  cors_rule {
    allowed_origins = var.cors_allowed_origins
    allowed_methods = ["GET", "HEAD"]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

############################################
# CloudFront OAI + distribution
############################################

resource "aws_cloudfront_origin_access_identity" "this" {
  comment = "OAI for ${var.bucket_name}"
}

# CC-02 (Sprint 5 iter 2) — Response headers policy.
#
# El portal Next.js (MT-3) declara `Cross-Origin-Embedder-Policy: require-corp`
# en su CSP. Ese policy implica que CUALQUIER recurso cross-origin (incluyendo
# logos servidos desde este CDN) DEBE responder con el header
# `Cross-Origin-Resource-Policy: cross-origin` o el `<img>` se bloquea silently.
#
# Headers configurados:
#   - Cross-Origin-Resource-Policy: cross-origin → permite al portal embebir
#     el logo del CDN aunque corran en distintos orígenes.
#   - Cross-Origin-Embedder-Policy: require-corp → consistente con el portal
#     (defensa en profundidad — si CloudFront sirviera HTML, requeriría CORP).
#   - Cross-Origin-Opener-Policy: same-origin → aislamiento por si el CDN
#     llegara a servir contenido HTML (poco probable, pero hardening).
#   - Cache-Control: public, max-age=3600, s-maxage=3600 → consistente con
#     el TTL CloudFront (default_ttl=3600). El cliente y el edge caché
#     coinciden, evitando "thundering herd" tras una invalidation.
#
# `override = true` en cada item asegura que estos headers ganen sobre
# cualquier metadata pre-existente del objeto S3 (e.g. PutObject sin
# Cache-Control quedaría sin header → el CDN ahora lo inyecta).
resource "aws_cloudfront_response_headers_policy" "this" {
  name    = "${var.bucket_name}-rhp"
  comment = "CORP/COEP/COOP + Cache-Control para tenant branding (CC-02)"

  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD"]
    }

    access_control_allow_origins {
      # `*` está OK: los assets son logos públicos servidos a portales del
      # tenant. La autenticación del bucket es OAI; el CDN es de lectura
      # pública por diseño (mismo modelo que static.example.com).
      items = ["*"]
    }

    access_control_max_age_sec = 3600
    origin_override            = true
  }

  security_headers_config {
    # CORP `cross-origin` — HABILITADOR de MT-3 (portal con COEP require-corp).
    # Sin este header los `<img src="...cloudfront.net/...">` se bloquean.
    cross_origin_resource_policy {
      cross_origin_resource_policy = "cross-origin"
      override                     = true
    }

    cross_origin_embedder_policy {
      cross_origin_embedder_policy = "require-corp"
      override                     = true
    }

    cross_origin_opener_policy {
      cross_origin_opener_policy = "same-origin"
      override                   = true
    }

    # Hardening adicional baseline (consistente con portal Next.js).
    content_type_options {
      override = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
  }

  custom_headers_config {
    # `Cache-Control` consistente con el TTL CloudFront.
    items {
      header   = "Cache-Control"
      value    = "public, max-age=3600, s-maxage=3600"
      override = true
    }
  }
}

# El bucket sólo permite GetObject vía OAI (no público). Cualquier intento
# de listar / leer fuera de CloudFront → 403.
data "aws_iam_policy_document" "bucket_oai" {
  statement {
    sid    = "AllowCloudFrontOAIReadOnly"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [aws_cloudfront_origin_access_identity.this.iam_arn]
    }
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.this.arn}/*"]
  }

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.this.arn,
      "${aws_s3_bucket.this.arn}/*",
    ]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = data.aws_iam_policy_document.bucket_oai.json
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Tenant branding CDN — ${var.bucket_name}"
  default_root_object = ""
  price_class         = var.price_class
  aliases             = var.aliases

  origin {
    domain_name = aws_s3_bucket.this.bucket_regional_domain_name
    origin_id   = "s3-${aws_s3_bucket.this.id}"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.this.cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    target_origin_id       = "s3-${aws_s3_bucket.this.id}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # CC-02 — response headers policy (CORP/COEP/COOP + Cache-Control).
    # Habilita que el portal Next.js (que declara COEP require-corp) embeba
    # los logos sin quedar bloqueado por la same-origin policy.
    response_headers_policy_id = aws_cloudfront_response_headers_policy.this.id

    # TTL 1h (3600s). Cliente ignora cache forzando un timestamp en el key,
    # por lo que el branding update aparece sin invalidations cuando el
    # portal pide `/{tenant}/logo-{newTs}.{ext}`.
    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == null ? true : false
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = var.acm_certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.acm_certificate_arn == null ? "TLSv1" : "TLSv1.2_2021"
  }

  tags = merge(var.tags, { Name = "${var.bucket_name}-cf", Component = "tenant-branding" })

  depends_on = [aws_s3_bucket_policy.this]
}
