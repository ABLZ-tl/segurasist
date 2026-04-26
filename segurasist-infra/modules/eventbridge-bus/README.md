# module/eventbridge-bus

EventBridge custom bus con archive opcional para replay (default 90 días).

## Inputs

| Name | Type | Default |
|------|------|---------|
| name | string | — |
| kms_key_arn | string | `null` |
| archive_enabled | bool | `true` |
| archive_retention_days | number | `90` |
| archive_event_pattern | string | `null` |

## Outputs

- `bus_arn`, `bus_name`, `archive_arn`

## Ejemplo

```hcl
module "eventbus" {
  source                = "../../modules/eventbridge-bus"
  name                  = "segurasist-dev-bus"
  kms_key_arn           = module.kms_general.key_arn
  archive_retention_days = 30

  tags = { Env = "dev" }
}
```
