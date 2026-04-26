output "record_name" {
  description = "Record name (FQDN)"
  value       = aws_route53_record.this.name
}

output "record_fqdn" {
  description = "Record FQDN"
  value       = aws_route53_record.this.fqdn
}
