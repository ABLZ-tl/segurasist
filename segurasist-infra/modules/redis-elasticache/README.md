# module/redis-elasticache

ElastiCache Serverless Redis con encryption in-transit (forzado por el servicio) + at-rest
con CMK, daily snapshots, y caps configurables de storage y ECPU.

## Inputs

| Name | Type | Default |
|------|------|---------|
| name | string | — |
| engine | string | `redis` (also `valkey`) |
| major_engine_version | string | `7` |
| subnet_ids | list(string) | — (private-data) |
| security_group_ids | list(string) | — |
| kms_key_id | string | — |
| daily_snapshot_time | string | `07:00` |
| snapshot_retention_limit | number | `7` |
| user_group_id | string | `null` |
| max_storage_gb | number | `5` |
| max_ecpu_per_second | number | `5000` |

## Outputs

- `cache_arn`, `cache_name`, `endpoint_address`, `endpoint_port`, `reader_endpoint_address`

## Ejemplo

```hcl
module "redis" {
  source              = "../../modules/redis-elasticache"
  name                = "segurasist-dev-redis"
  subnet_ids          = module.vpc.private_data_subnet_id_list
  security_group_ids  = [module.vpc.sg_redis_id]
  kms_key_id          = module.kms_general.key_arn

  tags = { Env = "dev", Component = "cache" }
}
```
