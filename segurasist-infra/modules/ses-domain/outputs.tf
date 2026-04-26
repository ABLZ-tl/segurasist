output "identity_arn" {
  description = "SES email identity ARN"
  value       = aws_sesv2_email_identity.this.arn
}

output "configuration_set_name" {
  description = "SES configuration set name"
  value       = aws_sesv2_configuration_set.this.configuration_set_name
}

output "dkim_tokens" {
  description = "DKIM tokens"
  value       = aws_sesv2_email_identity.this.dkim_signing_attributes[0].tokens
}

output "mail_from_domain" {
  description = "MAIL FROM subdomain"
  value       = aws_sesv2_email_identity_mail_from_attributes.this.mail_from_domain
}
