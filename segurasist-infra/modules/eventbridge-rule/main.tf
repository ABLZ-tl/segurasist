############################################
# S4-04 — EventBridge Rule (cron) → SQS target.
#
# Patrón S3 (DEVOPS): EventBridge rule schedule-based emite eventos
# periódicos hacia un SQS standard (target principal). El worker NestJS
# (`MonthlyReportsHandler`) hace polling de la cola y procesa los
# eventos con idempotencia DB-side (`monthly_report_runs` UNIQUE
# `tenant_id, period_year, period_month`).
#
# Por qué SQS y no Lambda:
#   - El backend NestJS ya corre poll loops para `reports`/`emails`/`pdf`/
#     `insureds-creation`. Reutilizamos el patrón sin agregar IaC para
#     deploy de un Lambda específico para "scheduler → API webhook".
#   - DLQ con `maxReceiveCount=3` ya viene del módulo `sqs-queue`,
#     redrive automático ⇒ failures silenciosos hubiera sido el escenario
#     con HTTP webhook.
#   - Idempotencia DB-side está alineada con DEVELOPER_GUIDE 2.2.
#
# CronExpr (UTC): default `cron(0 14 1 * ? *)` = día 1 de cada mes a
# 14:00 UTC = 08:00 CST con DST y 09:00 CST sin DST. El usuario en
# `var.cron_expression` puede sobrescribir si tiene reglas de DST distintas.
# AWS NO soporta cron en zonas horarias custom para `aws_cloudwatch_event_rule`
# (sólo UTC); por eso está en UTC. EventBridge Scheduler (servicio nuevo)
# sí soporta TZ — TODO Sprint 5 evaluar migración.
############################################

resource "aws_cloudwatch_event_rule" "this" {
  name                = var.name
  description         = var.description
  schedule_expression = var.cron_expression
  is_enabled          = var.enabled

  tags = merge(var.tags, { Name = var.name })
}

############################################
# Target — exactamente uno entre `target_sqs_arn` o `target_lambda_arn`.
#
# Cuando el target es SQS, EventBridge necesita permiso explícito para
# publicar en la cola. Lo añadimos vía `aws_sqs_queue_policy` separado
# pero NO lo incluimos en este módulo (el caller declara el policy
# attach en el env si quiere ese control granular). Para LocalStack
# (dev) la regla queda desconectada hasta que un test inyecta el message
# manualmente.
############################################

resource "aws_cloudwatch_event_target" "sqs" {
  count = var.target_sqs_arn == null ? 0 : 1

  rule      = aws_cloudwatch_event_rule.this.name
  target_id = "${var.name}-sqs"
  arn       = var.target_sqs_arn

  # Input transformer: EventBridge inyecta `aws.events.event-id` y demás
  # metadata. El worker ya espera un JSON propio con `kind`, `triggeredAt`,
  # `cronExpression`. Usamos `input` (literal) en lugar de `input_transformer`
  # porque el cron NO necesita campos del evento source.
  input = jsonencode({
    kind             = "cron.monthly_reports"
    cronRuleName     = var.name
    cronExpression   = var.cron_expression
    schemaVersion    = 1
  })
}

resource "aws_cloudwatch_event_target" "lambda" {
  count = var.target_lambda_arn == null ? 0 : 1

  rule      = aws_cloudwatch_event_rule.this.name
  target_id = "${var.name}-lambda"
  arn       = var.target_lambda_arn

  input = jsonencode({
    kind             = "cron.monthly_reports"
    cronRuleName     = var.name
    cronExpression   = var.cron_expression
    schemaVersion    = 1
  })
}

resource "aws_lambda_permission" "events_invoke" {
  count = var.target_lambda_arn == null ? 0 : 1

  statement_id  = "AllowExecutionFromEventBridge-${var.name}"
  action        = "lambda:InvokeFunction"
  function_name = var.target_lambda_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.this.arn
}
