############################################
# S5-2 — GuardDuty per-env module.
#
# Layered design:
#   - Org-level module (`global/security/`) enables GuardDuty across
#     the org with auto-enable for members. The detector resource
#     for THIS env account exists already (managed centrally).
#   - This module attaches env-specific configuration:
#       * Protection plans (S3/EKS/Malware/RDS/Lambda) — uses
#         `aws_guardduty_detector_feature` resources which are
#         declarative and idempotent against the existing detector.
#       * Findings S3 export bucket with KMS encryption + lifecycle.
#       * Optional trusted-IP / threat-intel lists.
#
# Why `data "aws_guardduty_detector"` + `aws_guardduty_detector_feature`
# instead of `aws_guardduty_detector` resource:
#   The detector is org-managed; importing it into this state would
#   double-manage and cause drift on every plan. `feature` resources
#   reference the detector by id and only manage their own lifecycle.
#
# LocalStack note: GuardDuty NO está soportado en LocalStack free
# tier. Esta plan/apply asume cuenta AWS real. Para dev local los
# tests se saltan con `count = var.create_detector ? 1 : 0` y la
# variable se deja false.
############################################

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id

  findings_bucket = coalesce(
    var.findings_bucket_name,
    "segurasist-security-findings-${var.environment}-${local.account_id}"
  )

  base_tags = merge(var.tags, {
    Module    = "guardduty"
    Component = "security-detection"
  })
}

############################################
# Detector lookup OR create
#
# When `create_detector = false` (default for member accounts) we
# resolve the detector via `aws_guardduty_detector` data source.
# The org auto-enable already created it. We use `count` on the
# data source so plans don't fail when explicitly bootstrapping.
############################################

resource "aws_guardduty_detector" "this" {
  count = var.create_detector ? 1 : 0

  enable                       = true
  finding_publishing_frequency = var.finding_publishing_frequency

  tags = merge(local.base_tags, { Name = "${var.name_prefix}-guardduty" })
}

data "aws_guardduty_detector" "existing" {
  count = var.create_detector ? 0 : 1
}

locals {
  detector_id = var.create_detector ? aws_guardduty_detector.this[0].id : data.aws_guardduty_detector.existing[0].id
}

############################################
# Protection plans (feature resources).
#
# `aws_guardduty_detector_feature` is the modern API replacing the
# inline `datasources` block on the detector. Each plan can be
# enabled / disabled independently without modifying the detector.
############################################

resource "aws_guardduty_detector_feature" "s3_data_events" {
  detector_id = local.detector_id
  name        = "S3_DATA_EVENTS"
  status      = var.enable_s3_protection ? "ENABLED" : "DISABLED"
}

resource "aws_guardduty_detector_feature" "eks_audit_logs" {
  detector_id = local.detector_id
  name        = "EKS_AUDIT_LOGS"
  status      = var.enable_eks_protection ? "ENABLED" : "DISABLED"
}

resource "aws_guardduty_detector_feature" "ebs_malware_protection" {
  detector_id = local.detector_id
  name        = "EBS_MALWARE_PROTECTION"
  status      = var.enable_malware_protection ? "ENABLED" : "DISABLED"
}

resource "aws_guardduty_detector_feature" "rds_login_events" {
  detector_id = local.detector_id
  name        = "RDS_LOGIN_EVENTS"
  status      = var.enable_rds_protection ? "ENABLED" : "DISABLED"
}

resource "aws_guardduty_detector_feature" "lambda_network_logs" {
  detector_id = local.detector_id
  name        = "LAMBDA_NETWORK_LOGS"
  status      = var.enable_lambda_protection ? "ENABLED" : "DISABLED"
}

resource "aws_guardduty_detector_feature" "eks_runtime_monitoring" {
  detector_id = local.detector_id
  name        = "EKS_RUNTIME_MONITORING"
  status      = var.enable_eks_protection ? "ENABLED" : "DISABLED"

  additional_configuration {
    name   = "EKS_ADDON_MANAGEMENT"
    status = var.enable_eks_protection ? "ENABLED" : "DISABLED"
  }
}

############################################
# Findings export S3 bucket + KMS encryption + lifecycle.
#
# We instantiate the bucket directly (not via `s3-bucket` module) to
# avoid the cross-region replication / object-lock surface and keep
# the bucket policy tight to GuardDuty service-principal only.
############################################

resource "aws_s3_bucket" "findings" {
  count = var.enable_findings_publishing ? 1 : 0

  bucket        = local.findings_bucket
  force_destroy = false

  tags = merge(local.base_tags, { Name = local.findings_bucket })
}

resource "aws_s3_bucket_ownership_controls" "findings" {
  count = var.enable_findings_publishing ? 1 : 0

  bucket = aws_s3_bucket.findings[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "findings" {
  count = var.enable_findings_publishing ? 1 : 0

  bucket                  = aws_s3_bucket.findings[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "findings" {
  count = var.enable_findings_publishing ? 1 : 0

  bucket = aws_s3_bucket.findings[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "findings" {
  count = var.enable_findings_publishing ? 1 : 0

  bucket = aws_s3_bucket.findings[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "findings" {
  count = var.enable_findings_publishing ? 1 : 0

  bucket = aws_s3_bucket.findings[0].id

  rule {
    id     = "transition-and-expire"
    status = "Enabled"

    filter {
      prefix = ""
    }

    transition {
      days          = var.findings_glacier_after_days
      storage_class = "GLACIER"
    }

    expiration {
      days = var.findings_total_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

############################################
# Bucket policy: allow GuardDuty service principal to publish.
############################################

data "aws_iam_policy_document" "findings_bucket" {
  count = var.enable_findings_publishing ? 1 : 0

  statement {
    sid    = "AllowGuardDutyAclCheck"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["guardduty.amazonaws.com"]
    }
    actions   = ["s3:GetBucketAcl", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.findings[0].arn]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid    = "AllowGuardDutyPutObject"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["guardduty.amazonaws.com"]
    }
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.findings[0].arn}/*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.findings[0].arn, "${aws_s3_bucket.findings[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "findings" {
  count = var.enable_findings_publishing ? 1 : 0

  bucket = aws_s3_bucket.findings[0].id
  policy = data.aws_iam_policy_document.findings_bucket[0].json
}

############################################
# Findings publisher (export destination).
#
# `aws_guardduty_publishing_destination` wires the detector to the
# bucket. Requires the bucket policy to allow GuardDuty PutObject.
############################################

resource "aws_guardduty_publishing_destination" "s3" {
  count = var.enable_findings_publishing ? 1 : 0

  detector_id     = local.detector_id
  destination_arn = aws_s3_bucket.findings[0].arn
  kms_key_arn     = var.kms_key_arn

  depends_on = [aws_s3_bucket_policy.findings]
}

############################################
# Trusted IP sets / threat intel sets (optional).
#
# Each list uploads a plain-text file (one CIDR per line) to the
# findings bucket under prefix `ipsets/` and registers it as an
# `aws_guardduty_ipset` (trusted) or `aws_guardduty_threatintelset`
# (malicious). Format: TXT (one entry per line).
############################################

resource "aws_s3_object" "trusted_ipsets" {
  for_each = var.enable_findings_publishing ? { for l in var.trusted_ip_lists : l.name => l } : {}

  bucket  = aws_s3_bucket.findings[0].id
  key     = "ipsets/trusted/${each.value.name}.txt"
  content = join("\n", each.value.cidrs)

  server_side_encryption = "aws:kms"
  kms_key_id             = var.kms_key_arn

  tags = merge(local.base_tags, { IPSet = each.value.name, Kind = "trusted" })
}

resource "aws_guardduty_ipset" "trusted" {
  for_each = var.enable_findings_publishing ? { for l in var.trusted_ip_lists : l.name => l } : {}

  detector_id = local.detector_id
  name        = "${var.name_prefix}-trusted-${each.value.name}"
  format      = "TXT"
  location    = "https://s3.amazonaws.com/${aws_s3_bucket.findings[0].id}/${aws_s3_object.trusted_ipsets[each.key].key}"
  activate    = true

  tags = merge(local.base_tags, { IPSet = each.value.name, Kind = "trusted" })
}

resource "aws_s3_object" "threat_intel_sets" {
  for_each = var.enable_findings_publishing ? { for l in var.threat_intel_lists : l.name => l } : {}

  bucket  = aws_s3_bucket.findings[0].id
  key     = "ipsets/threat-intel/${each.value.name}.txt"
  content = join("\n", each.value.cidrs)

  server_side_encryption = "aws:kms"
  kms_key_id             = var.kms_key_arn

  tags = merge(local.base_tags, { IPSet = each.value.name, Kind = "threat-intel" })
}

resource "aws_guardduty_threatintelset" "malicious" {
  for_each = var.enable_findings_publishing ? { for l in var.threat_intel_lists : l.name => l } : {}

  detector_id = local.detector_id
  name        = "${var.name_prefix}-threat-${each.value.name}"
  format      = "TXT"
  location    = "https://s3.amazonaws.com/${aws_s3_bucket.findings[0].id}/${aws_s3_object.threat_intel_sets[each.key].key}"
  activate    = true

  tags = merge(local.base_tags, { IPSet = each.value.name, Kind = "threat-intel" })
}
