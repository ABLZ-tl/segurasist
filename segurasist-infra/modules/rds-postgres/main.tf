locals {
  param_map = { for p in var.parameter_group.parameters : p.name => p }
  pi_kms    = coalesce(var.performance_insights_kms_key_id, var.kms_key_id)
}

resource "aws_db_subnet_group" "this" {
  name        = "${var.identifier}-subnets"
  description = "DB subnet group for ${var.identifier}"
  subnet_ids  = var.subnet_ids

  tags = merge(var.tags, { Name = "${var.identifier}-subnets" })
}

resource "aws_security_group" "this" {
  name        = "${var.identifier}-sg"
  description = "RDS instance ${var.identifier}"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.identifier}-sg" })
}

resource "aws_vpc_security_group_ingress_rule" "allowed" {
  for_each = toset(var.allowed_sg_ids)

  security_group_id            = aws_security_group.this.id
  description                  = "Postgres from ${each.value}"
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_parameter_group" "this" {
  name        = "${var.identifier}-pg"
  family      = var.parameter_group.family
  description = "Custom parameter group for ${var.identifier}"

  dynamic "parameter" {
    for_each = local.param_map
    content {
      name         = parameter.value.name
      value        = parameter.value.value
      apply_method = parameter.value.apply_method
    }
  }

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_iam_role" "rds_monitoring" {
  count = var.monitoring_interval > 0 ? 1 : 0
  name  = "${var.identifier}-rds-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  count      = var.monitoring_interval > 0 ? 1 : 0
  role       = aws_iam_role.rds_monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "this" {
  identifier     = var.identifier
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = var.storage_type
  storage_encrypted     = var.storage_encrypted
  kms_key_id            = var.kms_key_id

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.this.id]
  multi_az               = var.multi_az
  publicly_accessible    = false
  network_type           = "IPV4"

  username                      = var.master_username
  manage_master_user_password   = var.manage_master_user_password
  master_user_secret_kms_key_id = var.manage_master_user_password ? var.master_user_secret_kms_key_id : null

  parameter_group_name = aws_db_parameter_group.this.name

  performance_insights_enabled          = var.performance_insights_enabled
  performance_insights_kms_key_id       = var.performance_insights_enabled ? local.pi_kms : null
  performance_insights_retention_period = var.performance_insights_enabled ? var.performance_insights_retention_period : null

  monitoring_interval = var.monitoring_interval
  monitoring_role_arn = var.monitoring_interval > 0 ? aws_iam_role.rds_monitoring[0].arn : null

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  backup_retention_period = var.backup_retention_period
  backup_window           = var.backup_window
  maintenance_window      = var.maintenance_window
  copy_tags_to_snapshot   = var.copy_tags_to_snapshot
  delete_automated_backups = false

  deletion_protection = var.deletion_protection
  skip_final_snapshot = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.identifier}-final-${formatdate("YYYYMMDD-hhmm", timestamp())}"

  auto_minor_version_upgrade = var.auto_minor_version_upgrade
  apply_immediately          = false

  iam_database_authentication_enabled = true

  tags = merge(var.tags, { Name = var.identifier })

  lifecycle {
    ignore_changes = [final_snapshot_identifier]
  }
}

############################################
# Cross-region read replica (optional)
############################################

resource "aws_db_instance" "replica" {
  count    = var.cross_region_replica.enabled ? 1 : 0
  provider = aws.replica

  identifier     = "${var.identifier}-replica"
  instance_class = var.instance_class

  replicate_source_db = aws_db_instance.this.arn

  storage_encrypted = true
  kms_key_id        = var.cross_region_replica.kms_key_arn

  publicly_accessible = false
  multi_az            = false

  performance_insights_enabled          = var.performance_insights_enabled
  performance_insights_retention_period = var.performance_insights_enabled ? var.performance_insights_retention_period : null

  backup_retention_period = var.backup_retention_period
  copy_tags_to_snapshot   = true
  deletion_protection     = var.deletion_protection
  skip_final_snapshot     = true

  auto_minor_version_upgrade = var.auto_minor_version_upgrade

  tags = merge(var.tags, {
    Name = "${var.identifier}-replica"
    Role = "cross-region-replica"
  })
}
