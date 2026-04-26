# module/waf-web-acl

WAFv2 Web ACL con AWS Managed Rules (CommonRuleSet, KnownBadInputs, SQLi, AmazonIpReputation,
AnonymousIpList), rate-based rule por IP, CloudWatch metrics y logging opcional a CloudWatch
Log Group o Kinesis Firehose (con redacción de cabeceras `authorization` y `cookie`).

## Inputs principales

| Name | Type | Default |
|------|------|---------|
| name | string | — |
| scope | string | `REGIONAL` (also `CLOUDFRONT`) |
| rate_limit_per_5min | number | `500` (≈100 req/min) |
| managed_rule_groups | list(string) | 5 default groups |
| log_destination_arn | string | `null` (CW Log Group OR Firehose ARN) |

## Outputs

- `web_acl_arn`, `web_acl_id`, `web_acl_capacity`

## Ejemplo

```hcl
module "waf_api" {
  source = "../../modules/waf-web-acl"

  name                = "segurasist-prod-api-waf"
  scope               = "REGIONAL"
  rate_limit_per_5min = 500
  log_destination_arn = aws_cloudwatch_log_group.waf.arn

  tags = { Env = "prod", Component = "waf" }
}
```
