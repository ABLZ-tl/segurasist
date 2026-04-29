############################################
# S5-2 — Security Alarms.
#
# Pieces:
#   1. SNS topic `security-alerts-<env>` (KMS-encrypted).
#   2. Slack forwarder Lambda (subscribed to topic) reading webhook
#      from SecretsManager.
#   3. EventBridge rule: GuardDuty findings severity >= threshold.
#   4. CloudWatch alarm on SecurityHub failed compliance count.
#   5. Optional auto-quarantine Lambda.
############################################

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id

  base_tags = merge(var.tags, {
    Module    = "security-alarms"
    Component = "security-detection"
  })
}

############################################
# SNS topic.
############################################

resource "aws_sns_topic" "security_alerts" {
  name              = "${var.name_prefix}-security-alerts"
  kms_master_key_id = var.kms_key_arn

  tags = merge(local.base_tags, { Severity = "P1" })
}

data "aws_iam_policy_document" "security_alerts" {
  statement {
    sid     = "AllowEventBridgeAndCloudWatch"
    effect  = "Allow"
    actions = ["sns:Publish"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com", "cloudwatch.amazonaws.com"]
    }
    resources = [aws_sns_topic.security_alerts.arn]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "security_alerts" {
  arn    = aws_sns_topic.security_alerts.arn
  policy = data.aws_iam_policy_document.security_alerts.json
}

############################################
# Slack forwarder Lambda.
#
# The function reads the webhook from SecretsManager at runtime
# (SECRET_ARN env var). The handler lives at
# `lambdas/slack-forwarder/index.mjs` (S5-2 iter 2 — CC-19).
#
# IMPORTANT: before `terraform apply`, run
#   ./modules/security-alarms/lambdas/build.sh
# to populate `lambdas/<name>/node_modules/`. The `archive_file` data
# source zips the directory; `node_modules` MUST be present so the
# Lambda has its `@aws-sdk/*` deps. CI runs build.sh as a pre-apply
# step (see RB-020 §"Pre-deploy" + Sprint 5 ADR-0010 update).
############################################

data "archive_file" "slack_forwarder" {
  count = var.slack_webhook_secret_arn == null ? 0 : 1

  type        = "zip"
  source_dir  = "${path.module}/lambdas/slack-forwarder"
  output_path = "${path.module}/.tmp/slack-forwarder.zip"
  excludes    = ["package-lock.json", ".npmrc", "*.log"]
}

resource "aws_iam_role" "slack_forwarder" {
  count = var.slack_webhook_secret_arn == null ? 0 : 1

  name = "${var.name_prefix}-security-slack-forwarder"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.base_tags
}

resource "aws_iam_role_policy" "slack_forwarder" {
  count = var.slack_webhook_secret_arn == null ? 0 : 1

  name = "${var.name_prefix}-security-slack-forwarder"
  role = aws_iam_role.slack_forwarder[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.slack_webhook_secret_arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = var.kms_key_arn
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "slack_forwarder" {
  count = var.slack_webhook_secret_arn == null ? 0 : 1

  name              = "/aws/lambda/${var.name_prefix}-security-slack-forwarder"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = local.base_tags
}

resource "aws_lambda_function" "slack_forwarder" {
  count = var.slack_webhook_secret_arn == null ? 0 : 1

  function_name    = "${var.name_prefix}-security-slack-forwarder"
  description      = "Forwards security findings (GuardDuty + SecurityHub) to Slack."
  role             = aws_iam_role.slack_forwarder[0].arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.slack_forwarder[0].output_path
  source_code_hash = data.archive_file.slack_forwarder[0].output_base64sha256
  memory_size      = 256
  timeout          = 30

  environment {
    variables = {
      SECRET_ARN  = var.slack_webhook_secret_arn
      ENVIRONMENT = var.environment
    }
  }

  kms_key_arn = var.kms_key_arn

  tags = local.base_tags

  depends_on = [aws_cloudwatch_log_group.slack_forwarder]
}

resource "aws_sns_topic_subscription" "slack" {
  count = var.slack_webhook_secret_arn == null ? 0 : 1

  topic_arn = aws_sns_topic.security_alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.slack_forwarder[0].arn
}

resource "aws_lambda_permission" "sns_invoke_slack" {
  count = var.slack_webhook_secret_arn == null ? 0 : 1

  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.slack_forwarder[0].function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.security_alerts.arn
}

############################################
# EventBridge rule: GuardDuty HIGH/CRITICAL → SNS.
#
# GuardDuty severity is float 0.1-8.9. AWS scale:
#   LOW      = [0.1, 4.0)
#   MEDIUM   = [4.0, 7.0)
#   HIGH     = [7.0, 8.9)
#   CRITICAL = [9.0, 10.0)  (rare; mostly for malware findings)
# We match severity numeric-equals to the [threshold, 10] range using
# `numeric` event pattern operator.
############################################

resource "aws_cloudwatch_event_rule" "guardduty_high" {
  name        = "${var.name_prefix}-guardduty-high-critical"
  description = "GuardDuty findings severity >= ${var.severity_alert_threshold} (HIGH/CRITICAL). Routes to security-alerts SNS."

  event_pattern = jsonencode({
    source        = ["aws.guardduty"]
    "detail-type" = ["GuardDuty Finding"]
    detail = {
      severity = [{ "numeric" = [">=", var.severity_alert_threshold] }]
    }
  })

  tags = local.base_tags
}

resource "aws_cloudwatch_event_target" "guardduty_high_sns" {
  rule      = aws_cloudwatch_event_rule.guardduty_high.name
  target_id = "${var.name_prefix}-gd-high-sns"
  arn       = aws_sns_topic.security_alerts.arn
}

############################################
# CloudWatch alarm: SecurityHub failed compliance count > N in 1h.
#
# Security Hub publishes the metric `Findings` to namespace
# `AWS/SecurityHub` only via Security Hub Insights. To get a clean
# numeric metric we use `aws_cloudwatch_event_rule` to count
# `Security Hub Findings - Imported` events with compliance status
# FAILED via a metric filter — but metric filters apply to log groups.
# Simpler: use the `aws.securityhub` derived metric via a
# `aws_cloudwatch_event_rule` that puts a custom metric (not GA), OR
# rely on Security Hub Insights aggregator. Sprint 5 iter 1 ships
# the simpler path: an EventBridge rule counts FAILED findings into
# a CloudWatch metric via `put_events` API → metric_filter.
#
# For iter 1 we ship a CloudWatch composite alarm anchor that the
# detail Sprint 5+ work can refine. The metric below references
# `SegurAsist/Security` namespace populated by the Slack forwarder
# Lambda (which emits one EMF metric per finding processed).
############################################

resource "aws_cloudwatch_metric_alarm" "securityhub_failed_compliance" {
  alarm_name          = "${var.name_prefix}-securityhub-failed-compliance"
  alarm_description   = "Security Hub failed compliance findings > ${var.securityhub_failed_threshold} in 1h. Source: SegurAsist/Security EMF metric emitted by slack-forwarder."
  namespace           = "SegurAsist/Security"
  metric_name         = "SecurityHubFailedCompliance"
  dimensions          = { Environment = var.environment }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.securityhub_failed_threshold
  treat_missing_data  = "notBreaching"

  alarm_actions             = [aws_sns_topic.security_alerts.arn]
  ok_actions                = [aws_sns_topic.security_alerts.arn]
  insufficient_data_actions = []

  tags = local.base_tags
}

############################################
# Optional auto-quarantine Lambda.
#
# Triggered by EventBridge rule matching `Backdoor:EC2/...` finding
# types. The Lambda calls EC2 ModifyInstanceAttribute to attach the
# quarantine SG and tags the instance. Idempotent (no-op if already
# quarantined). Default disabled in dev — auto-actions on detection
# need canary review.
############################################

resource "aws_iam_role" "quarantine" {
  count = var.enable_auto_quarantine ? 1 : 0

  name = "${var.name_prefix}-security-quarantine"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.base_tags
}

resource "aws_iam_role_policy" "quarantine" {
  count = var.enable_auto_quarantine ? 1 : 0

  name = "${var.name_prefix}-security-quarantine"
  role = aws_iam_role.quarantine[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:ModifyInstanceAttribute",
          "ec2:DescribeInstances",
          "ec2:CreateTags",
          "ec2:DescribeSecurityGroups",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:CreateNetworkInterface", "lambda:DescribeNetworkInterfaces", "lambda:DeleteNetworkInterface"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "quarantine_vpc" {
  count = var.enable_auto_quarantine ? 1 : 0

  role       = aws_iam_role.quarantine[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_cloudwatch_log_group" "quarantine" {
  count = var.enable_auto_quarantine ? 1 : 0

  name              = "/aws/lambda/${var.name_prefix}-security-quarantine"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = local.base_tags
}

data "archive_file" "quarantine" {
  count = var.enable_auto_quarantine ? 1 : 0

  type        = "zip"
  source_dir  = "${path.module}/lambdas/quarantine"
  output_path = "${path.module}/.tmp/quarantine.zip"
  excludes    = ["package-lock.json", ".npmrc", "*.log"]
}

resource "aws_lambda_function" "quarantine" {
  count = var.enable_auto_quarantine ? 1 : 0

  function_name    = "${var.name_prefix}-security-quarantine"
  description      = "Auto-quarantines EC2 instances on Backdoor:EC2/* GuardDuty findings."
  role             = aws_iam_role.quarantine[0].arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.quarantine[0].output_path
  source_code_hash = data.archive_file.quarantine[0].output_base64sha256
  memory_size      = 256
  timeout          = 30

  environment {
    variables = {
      QUARANTINE_SG_ID = var.quarantine_security_group_id
      ENVIRONMENT      = var.environment
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.vpc_subnet_ids) > 0 ? [1] : []
    content {
      subnet_ids         = var.vpc_subnet_ids
      security_group_ids = var.vpc_security_group_ids
    }
  }

  kms_key_arn = var.kms_key_arn

  tags = local.base_tags

  depends_on = [aws_cloudwatch_log_group.quarantine]
}

resource "aws_cloudwatch_event_rule" "guardduty_backdoor" {
  count = var.enable_auto_quarantine ? 1 : 0

  name        = "${var.name_prefix}-guardduty-backdoor-ec2"
  description = "Match GuardDuty Backdoor:EC2/* findings → auto-quarantine Lambda."

  event_pattern = jsonencode({
    source        = ["aws.guardduty"]
    "detail-type" = ["GuardDuty Finding"]
    detail = {
      type = [{ prefix = "Backdoor:EC2/" }]
    }
  })

  tags = local.base_tags
}

resource "aws_cloudwatch_event_target" "quarantine_invoke" {
  count = var.enable_auto_quarantine ? 1 : 0

  rule      = aws_cloudwatch_event_rule.guardduty_backdoor[0].name
  target_id = "${var.name_prefix}-quarantine-lambda"
  arn       = aws_lambda_function.quarantine[0].arn
}

resource "aws_lambda_permission" "events_invoke_quarantine" {
  count = var.enable_auto_quarantine ? 1 : 0

  statement_id  = "AllowEventBridgeInvokeQuarantine"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.quarantine[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.guardduty_backdoor[0].arn
}
