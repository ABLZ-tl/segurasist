# module/cloudwatch-alarm

Wrapper liviano sobre `aws_cloudwatch_metric_alarm` con SNS topic destino para alarm + ok
actions, evaluation/datapoints configurables, soporte para percentiles vía
`extended_statistic`.

## Inputs principales

| Name | Type | Default |
|------|------|---------|
| name | string | — |
| metric_name | string | — |
| namespace | string | — |
| dimensions | map(string) | `{}` |
| statistic | string | `Average` |
| extended_statistic | string | `null` (ej. `p95`) |
| period_seconds | number | `60` |
| evaluation_periods | number | `5` |
| datapoints_to_alarm | number | `3` |
| comparison_operator | string | `GreaterThanThreshold` |
| threshold | number | — |
| treat_missing_data | string | `missing` |
| sns_topic_arn | string | — |

## Outputs

- `alarm_arn`, `alarm_name`

## Ejemplo

```hcl
module "alarm_rds_cpu" {
  source             = "../../modules/cloudwatch-alarm"
  name               = "segurasist-dev-rds-cpu-high"
  description        = "RDS CPU > 80% sostained"
  namespace          = "AWS/RDS"
  metric_name        = "CPUUtilization"
  dimensions         = { DBInstanceIdentifier = module.rds_main.db_instance_id }
  threshold          = 80
  evaluation_periods = 5
  datapoints_to_alarm = 3
  sns_topic_arn      = aws_sns_topic.alarms_p2.arn

  tags = { Env = "dev", Severity = "P2" }
}
```
