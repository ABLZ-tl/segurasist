data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_root = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"

  base_statements = [
    {
      Sid       = "EnableRootPermissions"
      Effect    = "Allow"
      Principal = { AWS = local.account_root }
      Action    = "kms:*"
      Resource  = "*"
    }
  ]

  service_statements = length(var.service_principals) == 0 ? [] : [
    {
      Sid       = "AllowAWSServices"
      Effect    = "Allow"
      Principal = { Service = var.service_principals }
      Action = [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey*",
        "kms:DescribeKey",
      ]
      Resource = "*"
    }
  ]

  principal_statements = length(var.additional_principals) == 0 ? [] : [
    {
      Sid       = "AllowAdditionalPrincipals"
      Effect    = "Allow"
      Principal = { AWS = var.additional_principals }
      Action = [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey*",
        "kms:DescribeKey",
      ]
      Resource = "*"
    }
  ]
}

resource "aws_kms_key" "this" {
  description              = var.description
  key_usage                = var.key_usage
  customer_master_key_spec = var.customer_master_key_spec
  deletion_window_in_days  = var.deletion_window_in_days
  enable_key_rotation      = var.enable_key_rotation
  multi_region             = var.multi_region

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = concat(local.base_statements, local.service_statements, local.principal_statements)
  })

  tags = merge(var.tags, { Alias = var.alias })
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.alias}"
  target_key_id = aws_kms_key.this.key_id
}
