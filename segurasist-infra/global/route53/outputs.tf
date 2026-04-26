output "zone_id" {
  description = "Route53 hosted zone ID"
  value       = aws_route53_zone.primary.zone_id
}

output "name_servers" {
  description = "Route53 zone name servers (configure at registrar)"
  value       = aws_route53_zone.primary.name_servers
}

output "wildcard_certificate_arn_regional" {
  description = "Wildcard ACM cert ARN in mx-central-1 — for ALB / App Runner / API Gateway"
  value       = aws_acm_certificate_validation.wildcard_regional.certificate_arn
}

output "wildcard_certificate_arn_us_east_1" {
  description = "Wildcard ACM cert ARN in us-east-1 — for CloudFront / Amplify Hosting"
  value       = aws_acm_certificate_validation.wildcard_us_east_1.certificate_arn
}

output "health_check_ids" {
  description = "Map health-check name -> ID"
  value       = { for k, h in aws_route53_health_check.this : k => h.id }
}
