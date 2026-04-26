resource "aws_elasticache_serverless_cache" "this" {
  name                 = var.name
  engine               = var.engine
  major_engine_version = var.major_engine_version

  subnet_ids         = var.subnet_ids
  security_group_ids = var.security_group_ids
  kms_key_id         = var.kms_key_id

  daily_snapshot_time      = var.daily_snapshot_time
  snapshot_retention_limit = var.snapshot_retention_limit
  user_group_id            = var.user_group_id

  cache_usage_limits {
    data_storage {
      maximum = var.max_storage_gb
      unit    = "GB"
    }

    ecpu_per_second {
      maximum = var.max_ecpu_per_second
    }
  }

  tags = merge(var.tags, { Name = var.name })
}
