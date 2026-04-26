# module/s3-bucket

S3 bucket con defaults seguros: SSE-KMS obligatorio, Block Public Access, ownership
`BucketOwnerEnforced`, TLS-only enforce policy, versioning, Object Lock opcional
(COMPLIANCE/GOVERNANCE), lifecycle rules, CORS, server access logging y cross-region
replication opcional.

## Inputs principales

| Name | Type | Default |
|------|------|---------|
| name | string | — |
| sse_kms_key_arn | string | — (obligatorio) |
| block_public_access | bool | `true` |
| versioning_enabled | bool | `true` |
| object_lock_mode | string | `NONE` (también COMPLIANCE/GOVERNANCE) |
| default_retention_days | number | `730` |
| lifecycle_rules | list | `[]` |
| cors_rules | list | `[]` |
| cross_region_replication | object | `{enabled=false}` |
| log_target_bucket | string | `null` |
| force_destroy | bool | `false` |

## Outputs

- `bucket_id`, `bucket_arn`, `bucket_domain_name`, `replication_role_arn`

## Ejemplo (audit con Object Lock 24m)

```hcl
module "s3_audit" {
  source = "../../modules/s3-bucket"

  name             = "segurasist-prod-audit"
  sse_kms_key_arn  = module.kms_audit.key_arn

  versioning_enabled       = true
  object_lock_mode         = "COMPLIANCE"
  default_retention_days   = 730

  lifecycle_rules = [{
    id          = "archive-after-90d"
    transitions = [{ days = 90, storage_class = "DEEP_ARCHIVE" }]
  }]

  cross_region_replication = {
    enabled                = true
    destination_bucket_arn = "arn:aws:s3:::segurasist-prod-audit-dr"
    destination_kms_arn    = module.kms_audit_dr.key_arn
  }

  tags = { Env = "prod", Component = "audit" }
}
```
