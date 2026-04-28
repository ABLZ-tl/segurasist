############################################
# C-14 / P6 — CloudWatch alarms (prod)
#
# Mismas alarmas que staging + extras:
#   - WAF CLOUDFRONT alarm separado (us-east-1).
#   - RDS replica (cross-region) lag alarm.
#   - thresholds más agresivos, treat_missing_data = "breaching" en
#     audit metrics.
#   - alert_emails: rotation oncall + CISO secondary.
############################################

variable "alert_emails" {
  description = "Emails que reciben SNS oncall-p1 (prod). Recomendado: 2-3 (rotation + CISO)."
  type        = list(string)
  default     = []
}

############################################
# SNS topic + email subscriptions (region primaria + DR mirror)
############################################

resource "aws_sns_topic" "alerts" {
  name              = "${local.name_prefix}-oncall-p1"
  kms_master_key_id = module.kms_general.key_arn

  tags = merge(local.common_tags, { Component = "alerts", Severity = "P1" })
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts_topic.json
}

data "aws_iam_policy_document" "alerts_topic" {
  statement {
    sid     = "AllowCloudWatchAlarms"
    effect  = "Allow"
    actions = ["sns:Publish"]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "events.amazonaws.com"]
    }
    resources = [aws_sns_topic.alerts.arn]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_sns_topic_subscription" "alert_email" {
  for_each  = toset(var.alert_emails)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

# SNS topic clon en us-east-1 para alarmas WAF CLOUDFRONT (CW alarm
# regional al WebACL CLOUDFRONT vive en us-east-1).
resource "aws_sns_topic" "alerts_us_east_1" {
  provider = aws.us_east_1
  name     = "${local.name_prefix}-oncall-p1-us-east-1"

  tags = merge(local.common_tags, { Component = "alerts", Severity = "P1", Region = "us-east-1" })
}

resource "aws_sns_topic_policy" "alerts_us_east_1" {
  provider = aws.us_east_1
  arn      = aws_sns_topic.alerts_us_east_1.arn
  policy   = data.aws_iam_policy_document.alerts_topic_us_east_1.json
}

data "aws_iam_policy_document" "alerts_topic_us_east_1" {
  provider = aws.us_east_1
  statement {
    sid     = "AllowCloudWatchAlarmsUSE1"
    effect  = "Allow"
    actions = ["sns:Publish"]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
    resources = [aws_sns_topic.alerts_us_east_1.arn]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_sns_topic_subscription" "alert_email_use1" {
  provider  = aws.us_east_1
  for_each  = toset(var.alert_emails)
  topic_arn = aws_sns_topic.alerts_us_east_1.arn
  protocol  = "email"
  endpoint  = each.value
}

############################################
# Alarm 1 — App Runner 5xx (RB-001)
############################################

module "alarm_apprunner_5xx" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-apprunner-5xx-rate"
  description = "App Runner API 5xx > 3/min sostenido prod (RB-001)"
  namespace   = "AWS/AppRunner"
  metric_name = "5xxStatusResponse"
  # AWS/AppRunner dimensión ServiceName == nombre humano (no UUID).
  dimensions  = { ServiceName = "${local.name_prefix}-api" }

  statistic           = "Sum"
  period_seconds      = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 3
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-001" })
}

############################################
# Alarm 2 — RDS CPU (RB-002)
############################################

module "alarm_rds_cpu" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-rds-cpu-high"
  description = "RDS CPU > 75% sostenido 5 min prod (RB-002)"
  namespace   = "AWS/RDS"
  metric_name = "CPUUtilization"
  dimensions  = { DBInstanceIdentifier = module.rds_main.db_instance_id }

  statistic           = "Average"
  period_seconds      = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 5
  comparison_operator = "GreaterThanThreshold"
  threshold           = 75
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-002" })
}

############################################
# Alarm 3 — RDS connections saturation
############################################

module "alarm_rds_connections" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-rds-connections-high"
  description = "RDS connections > 50 (~63% of t4g.small max). Pool exhaustion inminente."
  namespace   = "AWS/RDS"
  metric_name = "DatabaseConnections"
  dimensions  = { DBInstanceIdentifier = module.rds_main.db_instance_id }

  statistic           = "Maximum"
  period_seconds      = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 50
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-002" })
}

############################################
# Alarm 4 — SQS DLQ depth
############################################

locals {
  # Per-queue runbook routing (F8 iter 2). RB-004 sigue siendo el "general
  # SQS DLQ"; RB-011/012 son los runbooks específicos del audit Sprint 5.
  queue_runbooks = {
    "layout"            = "RB-011"
    "insureds-creation" = "RB-011"
    "pdf"               = "RB-012"
    "emails"            = "RB-004"
    "reports"           = "RB-004"
  }
}

module "alarm_sqs_dlq_depth" {
  for_each = local.queues
  source   = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-sqs-${each.key}-dlq-depth"
  description = "DLQ depth > 0 en queue ${each.key} (ver ${lookup(local.queue_runbooks, each.key, "RB-004")})"
  namespace   = "AWS/SQS"
  metric_name = "ApproximateNumberOfMessagesVisible"
  dimensions  = { QueueName = module.sqs[each.key].dlq_name }

  statistic           = "Maximum"
  period_seconds      = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = lookup(local.queue_runbooks, each.key, "RB-004"), Queue = each.key })
}

############################################
# Alarm 5 — WAF REGIONAL blocked spike (RB-005)
############################################

module "alarm_waf_blocked_spike" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-waf-api-blocked-spike"
  description = "WAF REGIONAL (API) blocked > 500 req/5min prod (RB-005)"
  namespace   = "AWS/WAFV2"
  metric_name = "BlockedRequests"
  dimensions = {
    WebACL = module.waf_api.web_acl_name
    Region = var.aws_region
    Rule   = "ALL"
  }

  statistic           = "Sum"
  period_seconds      = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 500
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-005", WafScope = "REGIONAL" })
}

# WAF CLOUDFRONT métricas viven en us-east-1 → la alarma debe estar ahí.
module "alarm_waf_cloudfront_blocked_spike" {
  source = "../../modules/cloudwatch-alarm"
  providers = { aws = aws.us_east_1 }

  name        = "${local.name_prefix}-waf-cf-blocked-spike"
  description = "WAF CLOUDFRONT (Amplify) blocked > 1000 req/5min prod (RB-005)"
  namespace   = "AWS/WAFV2"
  metric_name = "BlockedRequests"
  dimensions = {
    WebACL = module.waf_cloudfront.web_acl_name
    Region = "CloudFront"
    Rule   = "ALL"
  }

  statistic           = "Sum"
  period_seconds      = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 1000
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts_us_east_1.arn
  tags          = merge(local.common_tags, { Runbook = "RB-005", WafScope = "CLOUDFRONT" })
}

############################################
# Alarm 6 — SES bounce rate
############################################

module "alarm_ses_bounce_rate" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-ses-bounce-rate-high"
  description = "SES Reputation.BounceRate > 5% (alarma antes de suspensión 10%)"
  namespace   = "AWS/SES"
  metric_name = "Reputation.BounceRate"
  dimensions  = {}

  statistic           = "Average"
  period_seconds      = 900
  evaluation_periods  = 4
  datapoints_to_alarm = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0.05
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-004" })
}

############################################
# Alarm 7 — AuditWriter degraded
############################################

module "alarm_audit_writer_degraded" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-audit-writer-degraded"
  description = "AuditWriter SLI < 1 (degraded). RB-007."
  namespace   = "SegurAsist/Audit"
  metric_name = "AuditWriterHealth"
  dimensions  = { Environment = var.environment }

  statistic           = "Average"
  period_seconds      = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-007" })
}

############################################
# Alarm 8 — Audit S3 mirror lag
############################################

module "alarm_audit_mirror_lag" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-audit-mirror-lag"
  description = "Audit S3 mirror lag > 60s (RB-007)"
  namespace   = "SegurAsist/Audit"
  metric_name = "MirrorLagSeconds"
  dimensions  = { Environment = var.environment }

  statistic           = "Maximum"
  period_seconds      = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 60
  treat_missing_data  = "breaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-007" })
}

############################################
# Alarm 9 — Audit chain tampering (RB-013)
############################################

module "alarm_audit_chain_tampering" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-audit-chain-tampering"
  description = "Audit chain verifier valid=false → P1 forensic, freeze prod (RB-013)"
  namespace   = "SegurAsist/Audit"
  metric_name = "AuditChainValid"
  dimensions  = { Environment = var.environment }

  statistic           = "Minimum"
  period_seconds      = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-013", Severity = "P1-Security" })
}

############################################
# Alarm 10 — Lambda errors
############################################

locals {
  # Tag `Runbook` por-lambda (F8 iter 2) — on-call llega directo al runbook.
  lambda_functions = {
    pdf_renderer = { name = module.lambda_pdf.function_name,          runbook = "RB-012" }
    emailer      = { name = module.lambda_emailer.function_name,      runbook = "RB-004" }
    audit_export = { name = module.lambda_audit_export.function_name, runbook = "RB-007" }
  }
}

module "alarm_lambda_errors" {
  for_each = local.lambda_functions
  source   = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-lambda-${each.key}-errors"
  description = "Lambda ${each.key} Errors > 0 en 5 min prod."
  namespace   = "AWS/Lambda"
  metric_name = "Errors"
  dimensions  = { FunctionName = each.value.name }

  statistic           = "Sum"
  period_seconds      = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = each.value.runbook, Lambda = each.key })
}

############################################
# Alarm 11 — Cognito throttle
############################################

module "alarm_cognito_throttle" {
  for_each = {
    admin   = module.cognito_admin.user_pool_id
    insured = module.cognito_insured.user_pool_id
  }
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-cognito-${each.key}-throttle"
  description = "Cognito ${each.key} ThrottleCount > 0 (capacity bump)"
  namespace   = "AWS/Cognito"
  metric_name = "ThrottleCount"
  dimensions  = { UserPool = each.value, UserPoolClient = "ALL" }

  statistic           = "Sum"
  period_seconds      = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Pool = each.key })
}

############################################
# Outputs
############################################

output "alerts_sns_topic_arn" {
  description = "SNS topic ARN para CloudWatch alarms (oncall-p1)"
  value       = aws_sns_topic.alerts.arn
}

output "alerts_sns_topic_us_east_1_arn" {
  description = "SNS topic ARN en us-east-1 (WAF CLOUDFRONT alarms)"
  value       = aws_sns_topic.alerts_us_east_1.arn
}

output "alarm_arns" {
  description = "Map alarm-name → ARN"
  value = merge(
    {
      apprunner_5xx              = module.alarm_apprunner_5xx.alarm_arn
      rds_cpu                    = module.alarm_rds_cpu.alarm_arn
      rds_connections            = module.alarm_rds_connections.alarm_arn
      waf_api_blocked_spike      = module.alarm_waf_blocked_spike.alarm_arn
      waf_cf_blocked_spike       = module.alarm_waf_cloudfront_blocked_spike.alarm_arn
      ses_bounce_rate            = module.alarm_ses_bounce_rate.alarm_arn
      audit_writer_degraded      = module.alarm_audit_writer_degraded.alarm_arn
      audit_mirror_lag           = module.alarm_audit_mirror_lag.alarm_arn
      audit_chain_tampering      = module.alarm_audit_chain_tampering.alarm_arn
    },
    { for k, m in module.alarm_sqs_dlq_depth : "sqs_dlq_${k}" => m.alarm_arn },
    { for k, m in module.alarm_lambda_errors : "lambda_errors_${k}" => m.alarm_arn },
    { for k, m in module.alarm_cognito_throttle : "cognito_throttle_${k}" => m.alarm_arn },
  )
}
