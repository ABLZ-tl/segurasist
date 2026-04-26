output "cache_arn" {
  description = "Serverless cache ARN"
  value       = aws_elasticache_serverless_cache.this.arn
}

output "cache_name" {
  description = "Serverless cache name"
  value       = aws_elasticache_serverless_cache.this.name
}

output "endpoint_address" {
  description = "Reader/writer endpoint address"
  value       = aws_elasticache_serverless_cache.this.endpoint[0].address
}

output "endpoint_port" {
  description = "Endpoint port"
  value       = aws_elasticache_serverless_cache.this.endpoint[0].port
}

output "reader_endpoint_address" {
  description = "Reader endpoint"
  value       = aws_elasticache_serverless_cache.this.reader_endpoint[0].address
}
