output "web_acl_arn" {
  description = "WAFv2 Web ACL ARN"
  value       = aws_wafv2_web_acl.this.arn
}

output "web_acl_id" {
  description = "WAFv2 Web ACL ID"
  value       = aws_wafv2_web_acl.this.id
}

output "web_acl_capacity" {
  description = "WAFv2 Web ACL consumed capacity (WCU)"
  value       = aws_wafv2_web_acl.this.capacity
}
