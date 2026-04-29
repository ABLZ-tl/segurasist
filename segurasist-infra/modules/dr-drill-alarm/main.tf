############################################
# G-1 Sprint 5 iter 1 — DR drill freshness alarm.
#
# Objetivo: avisar a #ops cuando han pasado más de N días desde el último
# drill exitoso (RB-018 / ADR-0011). Patrón:
#
#   AWS Backup-style "last successful drill" timestamp
#     → CloudWatch metric "DrillFreshnessDays" (publicada por el orquestador
#       al final de 99-runbook-helper.sh, fuera del scope de IaC)
#     → CloudWatch Alarm threshold 30d
#     → SNS topic
#     → Slack webhook subscription
#
# Iter 1 entregó alarm + topic. Sprint 5 iter 2: `99-runbook-helper.sh`
# publica la métrica al cierre exitoso (`VALIDATION_STATUS=PASS`) con
# dimension `Environment=<env>`. El módulo `dr-drill-iam` autoriza el
# `cloudwatch:PutMetricData` scoped a namespace `SegurAsist/DR`.
#
# El nombre del metric/namespace es contractual con el script: cualquier
# cambio aquí requiere actualizar 99-runbook-helper.sh en paralelo.
############################################

resource "aws_sns_topic" "dr_drill_due" {
  name              = "${var.name_prefix}-dr-drill-due"
  kms_master_key_id = var.kms_key_arn

  tags = merge(var.tags, { Component = "dr-drill-alarm" })
}

resource "aws_sns_topic_subscription" "slack" {
  count                  = var.slack_webhook_url == null ? 0 : 1
  topic_arn              = aws_sns_topic.dr_drill_due.arn
  protocol               = "https"
  endpoint               = var.slack_webhook_url
  endpoint_auto_confirms = true
}

resource "aws_cloudwatch_metric_alarm" "drill_freshness" {
  alarm_name          = "${var.name_prefix}-dr-drill-freshness"
  alarm_description   = "Fires when no successful DR drill was recorded in the last ${var.threshold_days} days. RB-018 / ADR-0011."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "DrillFreshnessDays"
  namespace           = "SegurAsist/DR"
  period              = 86400 # 1 day
  statistic           = "Maximum"
  threshold           = var.threshold_days
  treat_missing_data  = "breaching" # if no metric ever published → page

  dimensions = {
    Environment = var.environment
  }

  alarm_actions = [aws_sns_topic.dr_drill_due.arn]
  ok_actions    = [aws_sns_topic.dr_drill_due.arn]

  tags = merge(var.tags, { Component = "dr-drill-alarm" })
}
