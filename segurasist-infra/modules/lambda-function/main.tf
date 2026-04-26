data "aws_partition" "current" {}

locals {
  dlq_kms_key_arn = coalesce(var.dlq_kms_key_arn, var.kms_key_arn)
}

############################################
# DLQ (mandatory)
############################################

resource "aws_sqs_queue" "dlq" {
  name                              = "${var.function_name}-dlq"
  message_retention_seconds         = var.dlq_message_retention_seconds
  kms_master_key_id                 = local.dlq_kms_key_arn
  kms_data_key_reuse_period_seconds = 300
  sqs_managed_sse_enabled           = false

  tags = merge(var.tags, { Name = "${var.function_name}-dlq" })
}

############################################
# Execution role
############################################

resource "aws_iam_role" "this" {
  name = "${var.function_name}-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "vpc" {
  count      = var.vpc_config == null ? 0 : 1
  role       = aws_iam_role.this.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy_attachment" "xray" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy" "dlq" {
  name = "${var.function_name}-dlq-write"
  role = aws_iam_role.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.dlq.arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = local.dlq_kms_key_arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "additional" {
  count = length(var.additional_iam_statements) > 0 ? 1 : 0
  name  = "${var.function_name}-extra"
  role  = aws_iam_role.this.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = var.additional_iam_statements
  })
}

############################################
# Log group (created before function so retention applies)
############################################

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = var.tags
}

############################################
# Function
############################################

resource "aws_lambda_function" "this" {
  function_name = var.function_name
  description   = var.description
  role          = aws_iam_role.this.arn

  package_type = var.package_type
  image_uri    = var.package_type == "Image" ? var.image_uri : null
  runtime      = var.package_type == "Zip" ? var.runtime : null
  handler      = var.package_type == "Zip" ? var.handler : null
  filename     = var.filename
  s3_bucket    = var.s3_bucket
  s3_key       = var.s3_key

  memory_size                    = var.memory_size
  timeout                        = var.timeout
  architectures                  = var.architectures
  reserved_concurrent_executions = var.reserved_concurrency
  layers                         = var.layers
  kms_key_arn                    = var.kms_key_arn

  ephemeral_storage {
    size = var.ephemeral_storage_mb
  }

  tracing_config {
    mode = var.tracing_mode
  }

  dead_letter_config {
    target_arn = aws_sqs_queue.dlq.arn
  }

  dynamic "vpc_config" {
    for_each = var.vpc_config == null ? [] : [var.vpc_config]
    content {
      subnet_ids         = vpc_config.value.subnet_ids
      security_group_ids = vpc_config.value.security_group_ids
    }
  }

  dynamic "environment" {
    for_each = length(var.environment_variables) > 0 ? [1] : []
    content {
      variables = var.environment_variables
    }
  }

  tags = merge(var.tags, { Name = var.function_name })

  depends_on = [
    aws_cloudwatch_log_group.this,
    aws_iam_role_policy_attachment.basic,
  ]

  lifecycle {
    ignore_changes = [
      # CI/CD updates the deployed artifact; Terraform manages config only.
      filename,
      s3_key,
      image_uri,
    ]
  }
}
