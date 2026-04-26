locals {
  managed_rules_indexed = { for idx, name in var.managed_rule_groups : name => idx + 1 }
}

resource "aws_wafv2_web_acl" "this" {
  name  = var.name
  scope = var.scope

  default_action {
    allow {}
  }

  dynamic "rule" {
    for_each = local.managed_rules_indexed
    content {
      name     = rule.key
      priority = rule.value

      override_action {
        none {}
      }

      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.key
        }
      }

      visibility_config {
        sampled_requests_enabled   = true
        cloudwatch_metrics_enabled = true
        metric_name                = replace(rule.key, "/[^A-Za-z0-9]/", "")
      }
    }
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = length(var.managed_rule_groups) + 10

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitPerIP"
    }
  }

  visibility_config {
    sampled_requests_enabled   = true
    cloudwatch_metrics_enabled = true
    metric_name                = replace(var.name, "-", "")
  }

  tags = merge(var.tags, { Name = var.name })
}

############################################
# Logging configuration (CloudWatch or Firehose)
############################################

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  count = var.log_destination_arn == null ? 0 : 1

  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [var.log_destination_arn]

  redacted_fields {
    single_header {
      name = "authorization"
    }
  }

  redacted_fields {
    single_header {
      name = "cookie"
    }
  }
}
