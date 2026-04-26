data "aws_caller_identity" "current" {}
data "aws_caller_identity" "log_archive" {
  provider = aws.log_archive
}
data "aws_partition" "current" {}

locals {
  trail_bucket_name = "segurasist-org-cloudtrail-${var.log_archive_account_id}"
  retention_days    = var.cloudtrail_retention_years * 365
}

############################################
# GuardDuty (delegated admin = security account)
############################################

resource "aws_guardduty_detector" "this" {
  enable                       = true
  finding_publishing_frequency = "FIFTEEN_MINUTES"

  datasources {
    s3_logs { enable = true }
    kubernetes {
      audit_logs { enable = false }
    }
    malware_protection {
      scan_ec2_instance_with_findings {
        ebs_volumes { enable = true }
      }
    }
  }

  tags = merge(var.tags, { Name = "guardduty-org" })
}

resource "aws_guardduty_organization_admin_account" "this" {
  admin_account_id = data.aws_caller_identity.current.account_id
}

resource "aws_guardduty_organization_configuration" "this" {
  detector_id = aws_guardduty_detector.this.id
  auto_enable_organization_members = "ALL"

  datasources {
    s3_logs { auto_enable = true }
    kubernetes { audit_logs { enable = false } }
    malware_protection {
      scan_ec2_instance_with_findings {
        ebs_volumes { auto_enable = true }
      }
    }
  }
}

############################################
# Security Hub (delegated admin)
############################################

resource "aws_securityhub_account" "this" {
  enable_default_standards = true
}

resource "aws_securityhub_organization_admin_account" "this" {
  admin_account_id = data.aws_caller_identity.current.account_id

  depends_on = [aws_securityhub_account.this]
}

resource "aws_securityhub_organization_configuration" "this" {
  auto_enable           = true
  auto_enable_standards = "DEFAULT"

  organization_configuration {
    configuration_type = "CENTRAL"
  }

  depends_on = [aws_securityhub_organization_admin_account.this]
}

# Enable CIS AWS Foundations v2.0
resource "aws_securityhub_standards_subscription" "cis_v2" {
  standards_arn = "arn:${data.aws_partition.current.partition}:securityhub:mx-central-1::standards/cis-aws-foundations-benchmark/v/2.0.0"
  depends_on    = [aws_securityhub_account.this]
}

resource "aws_securityhub_standards_subscription" "aws_foundational" {
  standards_arn = "arn:${data.aws_partition.current.partition}:securityhub:mx-central-1::standards/aws-foundational-security-best-practices/v/1.0.0"
  depends_on    = [aws_securityhub_account.this]
}

############################################
# AWS Config aggregator
############################################

resource "aws_iam_role" "config_aggregator" {
  name = "segurasist-config-aggregator"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "config.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "config_aggregator" {
  role       = aws_iam_role.config_aggregator.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSConfigRoleForOrganizations"
}

resource "aws_config_configuration_aggregator" "org" {
  name = "segurasist-org-config-aggregator"

  organization_aggregation_source {
    all_regions = true
    role_arn    = aws_iam_role.config_aggregator.arn
  }

  depends_on = [aws_iam_role_policy_attachment.config_aggregator]
}

############################################
# Inspector v2 (delegated admin)
############################################

resource "aws_inspector2_delegated_admin_account" "this" {
  account_id = data.aws_caller_identity.current.account_id
}

resource "aws_inspector2_organization_configuration" "this" {
  auto_enable {
    ec2 = true
    ecr = true
    lambda = true
    lambda_code = true
  }

  depends_on = [aws_inspector2_delegated_admin_account.this]
}

############################################
# CloudTrail org-wide -> log-archive bucket (Object Lock)
############################################

# Bucket lives in log-archive account
resource "aws_s3_bucket" "trail" {
  provider            = aws.log_archive
  bucket              = local.trail_bucket_name
  object_lock_enabled = true
  force_destroy       = false

  tags = merge(var.tags, { Name = local.trail_bucket_name })
}

resource "aws_s3_bucket_ownership_controls" "trail" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.trail.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_public_access_block" "trail" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.trail.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "trail" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.trail.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_kms_key" "trail" {
  provider                = aws.log_archive
  description             = "CMK for org CloudTrail in log-archive"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnableRoot"
        Effect    = "Allow"
        Principal = { AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.log_archive.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "AllowCloudTrail"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = ["kms:GenerateDataKey*", "kms:Decrypt", "kms:DescribeKey"]
        Resource  = "*"
        Condition = {
          StringEquals = { "aws:SourceArn" = "arn:${data.aws_partition.current.partition}:cloudtrail:mx-central-1:${data.aws_caller_identity.current.account_id}:trail/segurasist-org-trail" }
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_kms_alias" "trail" {
  provider      = aws.log_archive
  name          = "alias/segurasist-org-cloudtrail"
  target_key_id = aws_kms_key.trail.key_id
}

resource "aws_s3_bucket_server_side_encryption_configuration" "trail" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.trail.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.trail.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_object_lock_configuration" "trail" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.trail.id

  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = local.retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.trail]
}

resource "aws_s3_bucket_policy" "trail" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.trail.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AWSCloudTrailAclCheck"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:GetBucketAcl"
        Resource  = aws_s3_bucket.trail.arn
        Condition = {
          StringEquals = { "AWS:SourceOrgID" = var.organization_id }
        }
      },
      {
        Sid       = "AWSCloudTrailWrite"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.trail.arn}/AWSLogs/${var.organization_id}/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl"   = "bucket-owner-full-control"
            "AWS:SourceOrgID" = var.organization_id
          }
        }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.trail.arn, "${aws_s3_bucket.trail.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }
    ]
  })
}

# Trail itself lives in the security (delegated admin) account.
resource "aws_cloudtrail" "org" {
  name                          = "segurasist-org-trail"
  s3_bucket_name                = aws_s3_bucket.trail.id
  is_organization_trail         = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true
  include_global_service_events = true
  kms_key_id                    = aws_kms_key.trail.arn

  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }

  advanced_event_selector {
    name = "Log all S3 data events"
    field_selector {
      field  = "eventCategory"
      equals = ["Data"]
    }
    field_selector {
      field  = "resources.type"
      equals = ["AWS::S3::Object"]
    }
  }

  tags = merge(var.tags, { Name = "segurasist-org-trail" })

  depends_on = [aws_s3_bucket_policy.trail]
}
