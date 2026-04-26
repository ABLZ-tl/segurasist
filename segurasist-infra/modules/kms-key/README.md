# module/kms-key

CMK con rotation anual habilitada por default, key-policy mínima privilegio (root + opcionales)
y alias.

## Inputs principales

| Name | Type | Default |
|------|------|---------|
| alias | string | — (sin prefijo `alias/`) |
| description | string | — |
| enable_key_rotation | bool | `true` |
| multi_region | bool | `false` |
| service_principals | list(string) | `[]` (e.g., `["logs.amazonaws.com"]`) |
| additional_principals | list(string) | `[]` (ARNs de IAM roles) |
| deletion_window_in_days | number | `30` |
| tags | map(string) | `{}` |

## Outputs

- `key_id`, `key_arn`, `alias_name`, `alias_arn`

## Ejemplo

```hcl
module "kms_rds" {
  source = "../../modules/kms-key"

  alias       = "segurasist-dev-rds"
  description = "CMK for RDS encryption (dev)"

  service_principals = ["rds.amazonaws.com", "monitoring.rds.amazonaws.com"]
  tags               = { Env = "dev", Component = "rds" }
}
```
