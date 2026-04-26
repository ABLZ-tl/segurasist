# module/iam-permission-set

Wrapper para IAM Identity Center permission sets: attached managed policies, customer-managed
policies, inline policy opcional, permissions boundary opcional, y account assignments
(USER o GROUP -> account).

## Inputs

| Name | Type | Default |
|------|------|---------|
| instance_arn | string | — |
| name | string | — |
| description | string | — |
| session_duration | string | `PT4H` |
| managed_policies | list(string) | `[]` |
| customer_managed_policies | list(object) | `[]` |
| inline_policy | string | `null` |
| permissions_boundary | object | `null` |
| account_assignments | list(object) | `[]` |

## Outputs

- `permission_set_arn`, `permission_set_name`

## Ejemplo

```hcl
module "ps_devops" {
  source           = "../../modules/iam-permission-set"
  instance_arn     = data.aws_ssoadmin_instances.this.arns[0]
  name             = "DevOpsEngineer"
  description      = "DevOps + SRE access (no IAM root)"
  session_duration = "PT8H"
  managed_policies = [
    "arn:aws:iam::aws:policy/PowerUserAccess",
  ]

  account_assignments = [
    { account_id = local.dev_account_id,    principal_id = local.devops_group_id, principal_type = "GROUP" },
    { account_id = local.staging_account_id, principal_id = local.devops_group_id, principal_type = "GROUP" },
  ]
}
```
