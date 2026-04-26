data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name_prefix = "segurasist-${var.environment}"
  account_id  = data.aws_caller_identity.current.account_id

  azs = ["mx-central-1a", "mx-central-1b", "mx-central-1c"]

  public_cidrs = {
    "mx-central-1a" = "10.10.0.0/24"
    "mx-central-1b" = "10.10.1.0/24"
    "mx-central-1c" = "10.10.2.0/24"
  }

  private_app_cidrs = {
    "mx-central-1a" = "10.10.10.0/24"
    "mx-central-1b" = "10.10.11.0/24"
    "mx-central-1c" = "10.10.12.0/24"
  }

  private_data_cidrs = {
    "mx-central-1a" = "10.10.20.0/24"
    "mx-central-1b" = "10.10.21.0/24"
    "mx-central-1c" = "10.10.22.0/24"
  }

  common_tags = {
    Env = var.environment
  }
}

############################################
# KMS keys (general, rds, audit, secrets, dr)
############################################

module "kms_general" {
  source = "../../modules/kms-key"

  alias       = "${local.name_prefix}-general"
  description = "General-purpose CMK for ${var.environment}"
  service_principals = [
    "logs.amazonaws.com",
    "events.amazonaws.com",
    "sqs.amazonaws.com",
    "sns.amazonaws.com",
    "lambda.amazonaws.com",
  ]
  tags = local.common_tags
}

module "kms_rds" {
  source = "../../modules/kms-key"

  alias              = "${local.name_prefix}-rds"
  description        = "RDS storage CMK for ${var.environment}"
  service_principals = ["rds.amazonaws.com", "monitoring.rds.amazonaws.com"]
  tags               = local.common_tags
}

module "kms_audit" {
  source = "../../modules/kms-key"

  alias              = "${local.name_prefix}-audit"
  description        = "Audit S3 bucket CMK"
  service_principals = ["s3.amazonaws.com", "logs.amazonaws.com"]
  tags               = merge(local.common_tags, { Component = "audit" })
}

module "kms_secrets" {
  source = "../../modules/kms-key"

  alias              = "${local.name_prefix}-secrets"
  description        = "Secrets Manager CMK"
  service_principals = ["secretsmanager.amazonaws.com"]
  tags               = local.common_tags
}

module "kms_dr" {
  source = "../../modules/kms-key"
  providers = { aws = aws.dr }

  alias              = "${local.name_prefix}-dr"
  description        = "DR region CMK (us-east-1) for cross-region replication"
  multi_region       = true
  service_principals = ["rds.amazonaws.com", "s3.amazonaws.com"]
  tags               = merge(local.common_tags, { Region = "DR" })
}

############################################
# VPC
############################################

module "vpc" {
  source = "../../modules/vpc"

  name_prefix              = local.name_prefix
  cidr_block               = var.vpc_cidr
  azs                      = local.azs
  public_subnet_cidrs      = local.public_cidrs
  private_app_subnet_cidrs = local.private_app_cidrs
  private_data_subnet_cidrs = local.private_data_cidrs

  enable_nat_high_availability = false # cost-conscious in dev
  enable_flow_logs             = true
  flow_logs_retention_days     = 30

  tags = local.common_tags
}

############################################
# App Runner VPC connector
############################################

resource "aws_apprunner_vpc_connector" "this" {
  vpc_connector_name = "${local.name_prefix}-vpc-connector"
  subnets            = module.vpc.private_app_subnet_id_list
  security_groups    = [module.vpc.sg_apprunner_id]

  tags = local.common_tags
}

############################################
# ECR repository for API image
############################################

resource "aws_ecr_repository" "api" {
  name                 = "${local.name_prefix}-api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = module.kms_general.key_arn
  }

  tags = merge(local.common_tags, { Component = "api" })
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 30 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}

############################################
# WAF
############################################

resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${local.name_prefix}-api"
  retention_in_days = 30
  kms_key_id        = module.kms_general.key_arn

  tags = local.common_tags
}

module "waf_api" {
  source = "../../modules/waf-web-acl"

  name                = "${local.name_prefix}-api-waf"
  scope               = "REGIONAL"
  rate_limit_per_5min = 500
  log_destination_arn = aws_cloudwatch_log_group.waf.arn

  tags = merge(local.common_tags, { Component = "waf" })
}

############################################
# RDS
############################################

module "rds_main" {
  source    = "../../modules/rds-postgres"
  providers = { aws = aws, aws.replica = aws.dr }

  identifier        = "${local.name_prefix}-rds-main"
  engine_version    = "16.3"
  instance_class    = "db.t4g.small"
  allocated_storage = 20
  max_allocated_storage = 100

  multi_az            = false # dev
  storage_encrypted   = true
  kms_key_id          = module.kms_rds.key_arn
  deletion_protection = true

  performance_insights_enabled = true
  monitoring_interval          = 60

  backup_retention_period = 7
  backup_window           = "08:00-08:30"

  vpc_id         = module.vpc.vpc_id
  subnet_ids     = module.vpc.private_data_subnet_id_list
  allowed_sg_ids = [module.vpc.sg_apprunner_id, module.vpc.sg_lambda_vpc_id]

  manage_master_user_password   = true
  master_user_secret_kms_key_id = module.kms_secrets.key_arn

  cross_region_replica = {
    enabled     = false # not in dev
    region      = var.aws_dr_region
    kms_key_arn = module.kms_dr.key_arn
  }

  tags = merge(local.common_tags, { Component = "rds" })
}

############################################
# Cognito (admin + insured pools)
############################################

module "cognito_admin" {
  source = "../../modules/cognito-user-pool"

  name      = "${local.name_prefix}-admin"
  pool_kind = "admin"

  groups = {
    "AdminMAC"        = "Hospitales MAC admin"
    "Operador"        = "Operador altas/bajas"
    "AdminSegurAsist" = "Admin SegurAsist"
    "Supervisor"      = "Supervisor lectura"
  }

  resource_servers = {
    "https://api.${var.environment}.${var.domain_name}" = {
      name = "segurasist-api"
      scopes = [
        { name = "users:read",         description = "Read users" },
        { name = "users:write",        description = "Manage users" },
        { name = "certificates:read",  description = "Read certificates" },
        { name = "certificates:write", description = "Issue certificates" },
      ]
    }
  }

  app_clients = {
    "admin-web" = {
      callback_urls = ["https://admin.${var.environment}.${var.domain_name}/auth/callback"]
      logout_urls   = ["https://admin.${var.environment}.${var.domain_name}/auth/logout"]
      allowed_oauth_scopes = [
        "openid", "email", "profile",
        "https://api.${var.environment}.${var.domain_name}/users:read",
        "https://api.${var.environment}.${var.domain_name}/certificates:write",
      ]
    }
  }

  tags = merge(local.common_tags, { Component = "cognito-admin" })
}

module "cognito_insured" {
  source = "../../modules/cognito-user-pool"

  name      = "${local.name_prefix}-insured"
  pool_kind = "insured"

  groups = {
    "Insured" = "Insured user"
  }

  app_clients = {
    "portal-web" = {
      callback_urls = ["https://portal.${var.environment}.${var.domain_name}/auth/callback"]
      logout_urls   = ["https://portal.${var.environment}.${var.domain_name}/auth/logout"]
      allowed_oauth_scopes = ["openid", "email", "profile"]
    }
  }

  tags = merge(local.common_tags, { Component = "cognito-insured" })
}

############################################
# S3 buckets (4): uploads, certificates, exports, audit
############################################

module "s3_uploads" {
  source           = "../../modules/s3-bucket"
  name             = "${local.name_prefix}-uploads-${local.account_id}"
  sse_kms_key_arn  = module.kms_general.key_arn
  versioning_enabled = true

  cors_rules = [{
    allowed_origins = ["https://admin.${var.environment}.${var.domain_name}", "https://portal.${var.environment}.${var.domain_name}"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
  }]

  lifecycle_rules = [{
    id                          = "expire-noncurrent-90d"
    noncurrent_expiration_days  = 90
    abort_incomplete_multipart_days = 7
  }]

  tags = merge(local.common_tags, { Component = "uploads" })
}

module "s3_certificates" {
  source           = "../../modules/s3-bucket"
  name             = "${local.name_prefix}-certificates-${local.account_id}"
  sse_kms_key_arn  = module.kms_general.key_arn
  versioning_enabled = true

  lifecycle_rules = [{
    id          = "transition-to-ia-30d"
    transitions = [{ days = 30, storage_class = "STANDARD_IA" }]
  }]

  tags = merge(local.common_tags, { Component = "certificates" })
}

module "s3_exports" {
  source           = "../../modules/s3-bucket"
  name             = "${local.name_prefix}-exports-${local.account_id}"
  sse_kms_key_arn  = module.kms_general.key_arn
  versioning_enabled = true

  lifecycle_rules = [{
    id              = "expire-30d"
    expiration_days = 30
  }]

  tags = merge(local.common_tags, { Component = "exports" })
}

module "s3_audit" {
  source                 = "../../modules/s3-bucket"
  name                   = "${local.name_prefix}-audit-${local.account_id}"
  sse_kms_key_arn        = module.kms_audit.key_arn
  versioning_enabled     = true
  object_lock_mode       = "COMPLIANCE"
  default_retention_days = 730 # 24 months

  lifecycle_rules = [{
    id          = "archive-after-90d"
    transitions = [{ days = 90, storage_class = "DEEP_ARCHIVE" }]
  }]

  tags = merge(local.common_tags, { Component = "audit" })
}

############################################
# SQS queues (4): layout, certificates, emails, reports
############################################

locals {
  queues = {
    layout       = { vt = 60,  retention = 345600 }
    certificates = { vt = 120, retention = 345600 }
    emails       = { vt = 30,  retention = 345600 }
    reports      = { vt = 300, retention = 345600 }
  }
}

module "sqs" {
  source   = "../../modules/sqs-queue"
  for_each = local.queues

  name                       = "${local.name_prefix}-${each.key}"
  visibility_timeout_seconds = each.value.vt
  message_retention_seconds  = each.value.retention
  kms_key_arn                = module.kms_general.key_arn

  tags = merge(local.common_tags, { Component = "queue-${each.key}" })
}

############################################
# EventBridge bus
############################################

module "eventbus" {
  source                = "../../modules/eventbridge-bus"
  name                  = "${local.name_prefix}-bus"
  kms_key_arn           = module.kms_general.key_arn
  archive_retention_days = 30

  tags = merge(local.common_tags, { Component = "events" })
}

############################################
# Lambda placeholders (PDF + email worker + audit-export)
############################################

# Bootstrap placeholder zip (1-byte). CI/CD overwrites with real artifact.
data "archive_file" "lambda_placeholder" {
  type        = "zip"
  source_content          = "// placeholder - CI/CD will publish real artifacts"
  source_content_filename = "index.js"
  output_path             = "${path.module}/.tmp/lambda-placeholder.zip"
}

module "lambda_pdf" {
  source = "../../modules/lambda-function"

  function_name = "${local.name_prefix}-pdf-renderer"
  description   = "Renders certificate PDFs (Chromium layer)"
  filename      = data.archive_file.lambda_placeholder.output_path
  memory_size   = 2048
  timeout       = 60

  kms_key_arn = module.kms_general.key_arn

  vpc_config = {
    subnet_ids         = module.vpc.private_app_subnet_id_list
    security_group_ids = [module.vpc.sg_lambda_vpc_id]
  }

  reserved_concurrency = 20
  log_retention_days   = 30

  tags = merge(local.common_tags, { Component = "lambda-pdf" })
}

module "lambda_emailer" {
  source = "../../modules/lambda-function"

  function_name = "${local.name_prefix}-emailer"
  description   = "Processes email queue and sends via SES"
  filename      = data.archive_file.lambda_placeholder.output_path
  memory_size   = 512
  timeout       = 30

  kms_key_arn = module.kms_general.key_arn

  vpc_config = {
    subnet_ids         = module.vpc.private_app_subnet_id_list
    security_group_ids = [module.vpc.sg_lambda_vpc_id]
  }

  reserved_concurrency = 10
  log_retention_days   = 30

  tags = merge(local.common_tags, { Component = "lambda-emailer" })
}

module "lambda_audit_export" {
  source = "../../modules/lambda-function"

  function_name = "${local.name_prefix}-audit-export"
  description   = "Monthly export of Cognito users and audit logs to S3"
  filename      = data.archive_file.lambda_placeholder.output_path
  memory_size   = 1024
  timeout       = 300

  kms_key_arn = module.kms_general.key_arn

  reserved_concurrency = 5
  log_retention_days   = 90

  tags = merge(local.common_tags, { Component = "lambda-audit" })
}

############################################
# App Runner API service
############################################

module "apprunner_api" {
  source = "../../modules/apprunner-service"

  service_name      = "${local.name_prefix}-api"
  image_uri         = "${local.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/${aws_ecr_repository.api.name}:${var.image_tag_api}"
  ecr_repository_arn = aws_ecr_repository.api.arn
  vpc_connector_arn = aws_apprunner_vpc_connector.this.arn
  kms_key_arn       = module.kms_general.key_arn

  cpu    = "1024"
  memory = "2048"

  env_vars = {
    NODE_ENV   = "development"
    AWS_REGION = var.aws_region
    LOG_LEVEL  = "debug"
  }

  secrets = {
    DATABASE_URL = "${module.rds_main.master_user_secret_arn}:url::"
  }

  waf_web_acl_arn = module.waf_api.web_acl_arn

  auto_scaling = {
    min_size        = 1
    max_size        = 3
    max_concurrency = 100
  }

  tags = merge(local.common_tags, { Component = "api" })
}

############################################
# Amplify apps (admin + portal)
############################################

module "amplify_admin" {
  source     = "../../modules/amplify-app"
  name       = "${local.name_prefix}-admin"
  repository = "https://github.com/segurasist/segurasist-web"
  github_oauth_token_secret_arn = var.github_oauth_token_secret_arn

  environment_variables = {
    NEXT_PUBLIC_API_URL = "https://api.${var.environment}.${var.domain_name}"
    NEXT_PUBLIC_APP     = "admin"
  }

  branches = {
    "main" = { stage = "DEVELOPMENT", framework = "Next.js - SSR" }
  }

  tags = merge(local.common_tags, { Component = "amplify-admin" })
}

module "amplify_portal" {
  source     = "../../modules/amplify-app"
  name       = "${local.name_prefix}-portal"
  repository = "https://github.com/segurasist/segurasist-web"
  github_oauth_token_secret_arn = var.github_oauth_token_secret_arn

  environment_variables = {
    NEXT_PUBLIC_API_URL = "https://api.${var.environment}.${var.domain_name}"
    NEXT_PUBLIC_APP     = "portal"
  }

  branches = {
    "main" = { stage = "DEVELOPMENT", framework = "Next.js - SSR" }
  }

  tags = merge(local.common_tags, { Component = "amplify-portal" })
}

############################################
# Route53 records (skeleton)
############################################

module "dns_api" {
  source  = "../../modules/route53-record"
  zone_id = var.domain_zone_id
  name    = "api.${var.environment}.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = [module.apprunner_api.service_url]
}

# Admin / portal alias records resolved against Amplify default domain.
# In sprint 1 we'll wire Amplify domain associations with ACM-issued certs.
