# `dr-drill-alarm`

CloudWatch alarm + SNS topic + (optional) Slack webhook subscription that fires when no successful DR drill has been recorded in the last `threshold_days` (default 30).

The DR drill orchestrator (`scripts/dr-drill/99-runbook-helper.sh`) is expected to publish a custom CloudWatch metric `SegurAsist/DR.DrillFreshnessDays` (dimension `Environment`) on every successful run. The alarm flips to `ALARM` when the metric exceeds the threshold or when no metric has been published for the evaluation window (`treat_missing_data = "breaching"`).

References: RB-018, ADR-0011.

## Usage

```hcl
module "dr_drill_alarm" {
  source = "../../modules/dr-drill-alarm"

  name_prefix       = "segurasist-staging"
  environment       = "staging"
  kms_key_arn       = module.kms_general.key_arn
  threshold_days    = 30
  slack_webhook_url = var.slack_ops_webhook_url

  tags = local.common_tags
}
```

## Status (Sprint 5 iter 2)

- DONE — orquestador `99-runbook-helper.sh` publica la métrica al cierre exitoso (`VALIDATION_STATUS=PASS`).
- DONE — `dr-drill-iam` module provisiona `cloudwatch:PutMetricData` scoped a namespace `SegurAsist/DR`.
- Subscription confirmation: Slack incoming webhooks auto-confirm only over HTTPS; verificar con `aws sns list-subscriptions-by-topic` post-apply (manual smoke check tras primer terraform apply en staging).
