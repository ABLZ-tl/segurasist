# module/rds-postgres

PostgreSQL 16 en RDS con cifrado KMS, Multi-AZ opcional, Performance Insights, Enhanced
Monitoring, parameter group endurecido (pg_stat_statements, pgaudit, force_ssl, log slow
queries), backups, deletion protection, IAM auth, y replica cross-region opcional.

Provider alias `aws.replica` requerido (apuntando a la región DR).

## Inputs principales

| Name | Type | Default |
|------|------|---------|
| identifier | string | — |
| engine_version | string | `16.3` |
| instance_class | string | `db.t4g.small` |
| allocated_storage | number | `50` |
| max_allocated_storage | number | `500` |
| multi_az | bool | `true` |
| storage_encrypted | bool | `true` |
| kms_key_id | string | — (CMK ARN) |
| performance_insights_enabled | bool | `true` |
| monitoring_interval | number | `60` |
| backup_retention_period | number | `7` |
| backup_window | string | `08:00-08:30` |
| deletion_protection | bool | `true` |
| skip_final_snapshot | bool | `false` |
| vpc_id, subnet_ids, allowed_sg_ids | — | — |
| parameter_group | object | hardened defaults |
| manage_master_user_password | bool | `true` |
| master_user_secret_kms_key_id | string | `null` |
| cross_region_replica | object | `{enabled=false}` |

## Outputs

- `db_instance_id`, `db_instance_arn`
- `endpoint`, `address`, `port`
- `security_group_id`, `master_user_secret_arn`, `replica_arn`

## Ejemplo

```hcl
module "rds_main" {
  source = "../../modules/rds-postgres"
  providers = { aws = aws, aws.replica = aws.dr }

  identifier        = "segurasist-prod-rds-main"
  multi_az          = true
  kms_key_id        = module.kms_rds.key_arn
  vpc_id            = module.vpc.vpc_id
  subnet_ids        = module.vpc.private_data_subnet_id_list
  allowed_sg_ids    = [module.vpc.sg_apprunner_id, module.vpc.sg_lambda_vpc_id]

  manage_master_user_password   = true
  master_user_secret_kms_key_id = module.kms_secrets.key_arn

  cross_region_replica = {
    enabled     = true
    region      = "us-east-1"
    kms_key_arn = module.kms_rds_dr.key_arn
  }

  tags = { Env = "prod", Component = "rds" }
}
```
