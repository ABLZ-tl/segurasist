############################################
# Public hosted zone
############################################

resource "aws_route53_zone" "primary" {
  name = var.domain_name

  tags = { Name = var.domain_name }
}

############################################
# ACM wildcard cert — REGIONAL (mx-central-1)
# For ALB / App Runner / API Gateway in the workload region.
############################################

resource "aws_acm_certificate" "wildcard_regional" {
  domain_name               = var.domain_name
  subject_alternative_names = concat(["*.${var.domain_name}"], var.additional_subject_alternative_names)
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "*.${var.domain_name}-regional" }
}

############################################
# ACM wildcard cert — us-east-1
# For CloudFront and Amplify Hosting (which require us-east-1).
############################################

resource "aws_acm_certificate" "wildcard_us_east_1" {
  provider = aws.us_east_1

  domain_name               = var.domain_name
  subject_alternative_names = concat(["*.${var.domain_name}"], var.additional_subject_alternative_names)
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "*.${var.domain_name}-cloudfront" }
}

# Both certs share the same domain set, so DNS validation records
# are identical. We create them once in Route53.
resource "aws_route53_record" "wildcard_validation" {
  for_each = {
    for d in aws_acm_certificate.wildcard_regional.domain_validation_options : d.domain_name => {
      name   = d.resource_record_name
      record = d.resource_record_value
      type   = d.resource_record_type
    }
  }

  zone_id = aws_route53_zone.primary.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "wildcard_regional" {
  certificate_arn         = aws_acm_certificate.wildcard_regional.arn
  validation_record_fqdns = [for r in aws_route53_record.wildcard_validation : r.fqdn]
}

resource "aws_acm_certificate_validation" "wildcard_us_east_1" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.wildcard_us_east_1.arn
  validation_record_fqdns = [for r in aws_route53_record.wildcard_validation : r.fqdn]
}

############################################
# Health checks (optional)
############################################

resource "aws_route53_health_check" "this" {
  for_each = var.health_check_targets

  fqdn              = each.value.fqdn
  port              = each.value.port
  type              = each.value.type
  resource_path     = each.value.path
  failure_threshold = 3
  request_interval  = 30
  measure_latency   = true

  tags = { Name = each.key }
}
