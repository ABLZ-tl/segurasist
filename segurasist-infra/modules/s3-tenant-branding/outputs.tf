output "bucket_id" {
  description = "S3 bucket id (name)"
  value       = aws_s3_bucket.this.id
}

output "bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.this.arn
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain (`dxxxxxx.cloudfront.net`)"
  value       = aws_cloudfront_distribution.this.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution id (para invalidations manuales si se requiere)"
  value       = aws_cloudfront_distribution.this.id
}

output "oai_iam_arn" {
  description = "ARN de la OAI (sólo lectura desde CloudFront)"
  value       = aws_cloudfront_origin_access_identity.this.iam_arn
}

# CC-02 — response headers policy (CORP/COEP/COOP) — sprint 5 iter 2.
output "response_headers_policy_id" {
  description = "ID del aws_cloudfront_response_headers_policy con CORP cross-origin / COEP require-corp / COOP same-origin"
  value       = aws_cloudfront_response_headers_policy.this.id
}
