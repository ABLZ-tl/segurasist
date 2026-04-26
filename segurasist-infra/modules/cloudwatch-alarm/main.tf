resource "aws_cloudwatch_metric_alarm" "this" {
  alarm_name          = var.name
  alarm_description   = var.description
  namespace           = var.namespace
  metric_name         = var.metric_name
  dimensions          = var.dimensions
  statistic           = var.extended_statistic == null ? var.statistic : null
  extended_statistic  = var.extended_statistic
  period              = var.period_seconds
  evaluation_periods  = var.evaluation_periods
  datapoints_to_alarm = var.datapoints_to_alarm
  comparison_operator = var.comparison_operator
  threshold           = var.threshold
  treat_missing_data  = var.treat_missing_data
  actions_enabled     = var.actions_enabled

  alarm_actions             = [var.sns_topic_arn]
  ok_actions                = [var.sns_topic_arn]
  insufficient_data_actions = []

  tags = merge(var.tags, { Name = var.name })
}
