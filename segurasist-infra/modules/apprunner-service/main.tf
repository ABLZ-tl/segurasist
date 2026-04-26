data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

############################################
# IAM: ECR access role + instance role
############################################

resource "aws_iam_role" "ecr_access" {
  name = "${var.service_name}-ecr-access"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "build.apprunner.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecr_access" {
  role       = aws_iam_role.ecr_access.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

resource "aws_iam_role" "instance" {
  name = "${var.service_name}-instance"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "tasks.apprunner.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

locals {
  # Strip Secrets Manager JSON-key suffixes ("...:secret-name:json-key::") to base ARN.
  secret_arns_clean = [
    for arn in values(var.secrets) :
    can(regex("^arn:[^:]+:secretsmanager:", arn))
    ? regex("^(arn:[^:]+:secretsmanager:[^:]+:[^:]+:secret:[^:]+)", arn)[0]
    : arn
  ]
}

resource "aws_iam_role_policy" "instance_secrets" {
  count = length(var.secrets) > 0 ? 1 : 0
  name  = "${var.service_name}-secrets-read"
  role  = aws_iam_role.instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "ssm:GetParameter",
          "ssm:GetParameters",
        ]
        Resource = local.secret_arns_clean
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
        ]
        Resource = var.kms_key_arn
      }
    ]
  })
}

############################################
# Observability bundle (X-Ray)
############################################

resource "aws_apprunner_observability_configuration" "this" {
  count                          = var.observability_enabled ? 1 : 0
  observability_configuration_name = "${var.service_name}-obs"

  trace_configuration {
    vendor = "AWSXRAY"
  }

  tags = var.tags
}

############################################
# Auto-scaling configuration
############################################

resource "aws_apprunner_auto_scaling_configuration_version" "this" {
  auto_scaling_configuration_name = "${var.service_name}-as"
  min_size                        = var.auto_scaling.min_size
  max_size                        = var.auto_scaling.max_size
  max_concurrency                 = var.auto_scaling.max_concurrency

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

############################################
# Service
############################################

resource "aws_apprunner_service" "this" {
  service_name = var.service_name

  source_configuration {
    auto_deployments_enabled = var.auto_deployments_enabled

    authentication_configuration {
      access_role_arn = aws_iam_role.ecr_access.arn
    }

    image_repository {
      image_identifier      = var.image_uri
      image_repository_type = var.image_repository_type

      image_configuration {
        port = tostring(var.port)

        runtime_environment_variables = var.env_vars
        runtime_environment_secrets   = var.secrets
      }
    }
  }

  instance_configuration {
    cpu               = var.cpu
    memory            = var.memory
    instance_role_arn = aws_iam_role.instance.arn
  }

  network_configuration {
    egress_configuration {
      egress_type       = "VPC"
      vpc_connector_arn = var.vpc_connector_arn
    }
    ingress_configuration {
      is_publicly_accessible = true
    }
  }

  health_check_configuration {
    protocol            = var.health_check.protocol
    path                = var.health_check.path
    interval            = var.health_check.interval
    timeout             = var.health_check.timeout
    healthy_threshold   = var.health_check.healthy_threshold
    unhealthy_threshold = var.health_check.unhealthy_threshold
  }

  encryption_configuration {
    kms_key = var.kms_key_arn
  }

  auto_scaling_configuration_arn = aws_apprunner_auto_scaling_configuration_version.this.arn

  dynamic "observability_configuration" {
    for_each = var.observability_enabled ? [1] : []
    content {
      observability_enabled           = true
      observability_configuration_arn = aws_apprunner_observability_configuration.this[0].arn
    }
  }

  tags = merge(var.tags, { Name = var.service_name })
}

############################################
# WAF association (optional)
############################################

resource "aws_wafv2_web_acl_association" "this" {
  count = var.waf_web_acl_arn == null ? 0 : 1

  resource_arn = aws_apprunner_service.this.arn
  web_acl_arn  = var.waf_web_acl_arn
}
