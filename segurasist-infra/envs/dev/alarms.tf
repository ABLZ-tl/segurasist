############################################
# Variable local a este archivo — declarada aquí (en lugar de variables.tf
# global del env) para mantener el ownership: F5 es dueño de main.tf y
# F8 sólo agrega `alarms.tf`. Terraform permite declarar variables en
# cualquier .tf del root module.
############################################

variable "alert_emails" {
  description = "Emails que reciben notificaciones del SNS topic oncall-p1. En dev típicamente 1 mail; en prod 2-3 (rotation on-call)."
  type        = list(string)
  default     = []
}

############################################
# C-14 / P6 — CloudWatch alarms (dev)
#
# Antes de este archivo el módulo `cloudwatch-alarm` existía pero **NUNCA**
# se invocaba en `envs/{dev,staging,prod}/`. Resultado: on-call ciego ante
# saturación, tampering audit chain, bounce rate alto, DLQ depth, etc.
# Aquí instanciamos las 10 alarmas core + un SNS topic `oncall-p1` con
# subscripciones por email (var.alert_emails).
#
# Convenciones:
#   - Namespace AWS estándar (AWS/ApplicationELB, AWS/RDS, AWS/SQS,
#     AWS/Lambda, AWS/SES, AWS/WAFV2, AWS/Cognito) cuando aplica.
#   - Custom metrics SegurAsist/Audit (AuditWriterHealth, MirrorLagSeconds)
#     emitidas por el AuditWriterService — Sprint 5 cablea CloudWatch
#     EmbeddedMetricFormat. Por ahora la alarma queda armada; sin
#     datapoints la treat_missing_data política decide.
#   - En dev usamos `treat_missing_data = "notBreaching"` para evitar
#     spam pre-deploy. Staging/prod usan "breaching" (alerta si silencio).
############################################

############################################
# SNS topic + email subscriptions
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

############################################
# Alarm 1 — App Runner / ALB target 5xx rate
############################################

# App Runner emite métricas en namespace AWS/AppRunner con dimensión
# ServiceName. Alarmamos si 5xxStatusResponse > 5/min sostenido.
module "alarm_apprunner_5xx" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-apprunner-5xx-rate"
  description = "App Runner API 5xx > 5/min (RB-001 — API down)"
  namespace   = "AWS/AppRunner"
  metric_name = "5xxStatusResponse"
  # AWS/AppRunner emite con dimensión ServiceName == el nombre humano del
  # servicio (no el UUID). El módulo recibe `service_name = "${local.name_prefix}-api"`.
  dimensions  = { ServiceName = "${local.name_prefix}-api" }

  statistic           = "Sum"
  period_seconds      = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 5
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-001" })
}

############################################
# Alarm 2 — RDS CPU high (RB-002)
############################################

module "alarm_rds_cpu" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-rds-cpu-high"
  description = "RDS CPU > 80% sostenido 5 min (RB-002)"
  namespace   = "AWS/RDS"
  metric_name = "CPUUtilization"
  dimensions  = { DBInstanceIdentifier = module.rds_main.db_instance_id }

  statistic           = "Average"
  period_seconds      = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 5
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-002" })
}

############################################
# Alarm 3 — RDS connections saturation
############################################

# t4g.small = 79 max conns aprox. 80% = 63. Alarma a 50 (~63%) para
# alertar antes de pool exhaustion App Runner side.
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
# Alarm 4 — SQS DLQ depth (per queue)
############################################

# Cualquier mensaje en cualquier DLQ es señal de worker fallando.
# Threshold = 0 (aritmético: >0 alarma). Period 5 min para evitar flapping
# en redrives manuales.
locals {
  # Per-queue runbook routing (F8 iter 2). RB-004 sigue siendo el "general
  # SQS DLQ"; RB-011/012 son los runbooks específicos del audit Sprint 5.
  queue_runbooks = {
    "layout"            = "RB-011"
    "insureds-creation" = "RB-011"
    "pdf"               = "RB-012"
    "emails"            = "RB-004"
    "reports"           = "RB-004"
    "monthly-reports"   = "RB-014"
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
# Alarm 5 — WAF blocked spike (RB-005)
############################################

# Spike: >100 bloqueos en 5 min. Sirve para diferenciar baseline (decenas
# de scrapers) de un ataque sostenido. Investigar geo + ruleMatched.
module "alarm_waf_blocked_spike" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-waf-blocked-spike"
  description = "WAF blocked > 100 req/5min (RB-005 — investigar attack vs FP)"
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
  threshold           = 100
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-005" })
}

############################################
# Alarm 6 — SES bounce rate
############################################

# AWS SES Reputation namespace emite Reputation.BounceRate (porcentaje).
# Threshold AWS suspende cuenta a 10%; alarmamos a 5% para tener margen.
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
# Alarm 7 — AuditWriter degraded (custom metric)
############################################

# Custom metric SegurAsist/Audit/AuditWriterHealth = 1 healthy / 0 degraded
# emitida por AuditWriterService.healthCheck() vía EMF. Si Average < 1
# durante 3 datapoints → SLI degradado.
module "alarm_audit_writer_degraded" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-audit-writer-degraded"
  description = "AuditWriter SLI < 1 (degraded). RB-007 audit-degraded."
  namespace   = "SegurAsist/Audit"
  metric_name = "AuditWriterHealth"
  dimensions  = { Environment = var.environment }

  statistic           = "Average"
  period_seconds      = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-007" })
}

############################################
# Alarm 8 — Audit S3 mirror lag (custom metric)
############################################

# Lag = now() - last_mirrored_at (segundos). >60s en 3 datapoints → mirror
# pipeline atrasado. Cierra C3 del audit doc 06 (chain verifier ciego al
# silencio del mirror).
module "alarm_audit_mirror_lag" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-audit-mirror-lag"
  description = "Audit S3 mirror lag > 60s. RB-007 audit-degraded."
  namespace   = "SegurAsist/Audit"
  metric_name = "MirrorLagSeconds"
  dimensions  = { Environment = var.environment }

  statistic           = "Maximum"
  period_seconds      = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 60
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-007" })
}

############################################
# Alarm 9 — Audit chain tampering (custom metric — RB-013 NEW)
############################################

# AuditChainValid = 1 chain válida / 0 discrepancia. El verifier corre
# 1×/h vía EventBridge schedule (Sprint 5). Cualquier 0 → P1 incidente
# de tampering, freeze prod.
module "alarm_audit_chain_tampering" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-audit-chain-tampering"
  description = "Audit chain verifier reportó valid=false (RB-013 tampering)."
  namespace   = "SegurAsist/Audit"
  metric_name = "AuditChainValid"
  dimensions  = { Environment = var.environment }

  statistic           = "Minimum"
  period_seconds      = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-013", Severity = "P1-Security" })
}

############################################
# Alarm 10 — Lambda errors (PDF + emailer + audit-export)
############################################

locals {
  # Tag `Runbook` por-lambda para que la página on-call lleve directo al
  # runbook correcto (post F8 iter 2 — RB-011/012 son los slots renumerados
  # tras el audit Sprint 5). Si un nuevo Lambda se agrega, mapearlo aquí.
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
  description = "Lambda ${each.key} Errors > 0 en 5 min."
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
# Alarm 11 — Cognito throttled requests
############################################

# Si Cognito empieza a throttlear (TooManyRequestsException) significa
# que estamos quemando TPS hacia AdminInitiateAuth o equivalente.
module "alarm_cognito_throttle" {
  for_each = {
    admin   = module.cognito_admin.user_pool_id
    insured = module.cognito_insured.user_pool_id
  }
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-cognito-${each.key}-throttle"
  description = "Cognito ${each.key} pool ThrottleCount > 0 (capacity bump)"
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
# Alarm 12 — EventBridge rule FailedInvocations (S4-04)
############################################
#
# AWS/Events emite `FailedInvocations` cuando EventBridge no puede entregar
# un evento al target (e.g. SQS policy mal configurada, Lambda throttled,
# SQS quota). Cualquier valor > 0 en 5 min ⇒ ruptura del pipeline cron
# mensual. Runbook RB-014 (NEW Sprint 4) describe la respuesta on-call.
module "alarm_cron_monthly_reports_failed" {
  source = "../../modules/cloudwatch-alarm"

  name        = "${local.name_prefix}-cron-monthly-reports-failed"
  description = "EventBridge rule cron-monthly-reports FailedInvocations > 0 (S4-04, RB-014)"
  namespace   = "AWS/Events"
  metric_name = "FailedInvocations"
  dimensions  = { RuleName = module.cron_monthly_reports.rule_name }

  statistic           = "Sum"
  period_seconds      = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  sns_topic_arn = aws_sns_topic.alerts.arn
  tags          = merge(local.common_tags, { Runbook = "RB-014", Component = "cron" })
}

############################################
# Outputs (para que workflows post-deploy verifiquen ARNs)
############################################

output "alerts_sns_topic_arn" {
  description = "SNS topic ARN para CloudWatch alarms (oncall-p1)"
  value       = aws_sns_topic.alerts.arn
}

output "alarm_arns" {
  description = "Map alarm-name → ARN (smoke verification)"
  value = merge(
    {
      apprunner_5xx              = module.alarm_apprunner_5xx.alarm_arn
      rds_cpu                    = module.alarm_rds_cpu.alarm_arn
      rds_connections            = module.alarm_rds_connections.alarm_arn
      waf_blocked_spike          = module.alarm_waf_blocked_spike.alarm_arn
      ses_bounce_rate            = module.alarm_ses_bounce_rate.alarm_arn
      audit_writer_degraded      = module.alarm_audit_writer_degraded.alarm_arn
      audit_mirror_lag           = module.alarm_audit_mirror_lag.alarm_arn
      audit_chain_tampering      = module.alarm_audit_chain_tampering.alarm_arn
      cron_monthly_reports_failed = module.alarm_cron_monthly_reports_failed.alarm_arn
    },
    { for k, m in module.alarm_sqs_dlq_depth : "sqs_dlq_${k}" => m.alarm_arn },
    { for k, m in module.alarm_lambda_errors : "lambda_errors_${k}" => m.alarm_arn },
    { for k, m in module.alarm_cognito_throttle : "cognito_throttle_${k}" => m.alarm_arn },
  )
}
