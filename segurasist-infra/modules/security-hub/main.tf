############################################
# S5-2 — Security Hub per-env module.
#
# Architecture:
#   - `aws_securityhub_account` is created at org level. Member
#     accounts inherit the subscription via auto-enable. This module
#     only creates the account resource when explicitly bootstrapping
#     (var.create_account_subscription).
#   - Standards subscriptions ARE per-account: we declare them here
#     so each env can opt in/out independently of the org defaults.
#   - Disabled controls are managed via `aws_securityhub_standards_control`
#     which captures `control_status = "DISABLED"` + a `disabled_reason`.
#
# IMPORTANT: `aws_securityhub_standards_control` requires the standard
# subscription to have COMPLETED enabling its controls (eventually
# consistent: ~5-10 min after first apply). On bootstrap apply the
# disable resources may need a second `terraform apply` — this is
# expected AWS behaviour. Future iter: introduce `time_sleep` before
# disable resources if it becomes a CI flake.
############################################

data "aws_partition" "current" {}
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  partition  = data.aws_partition.current.partition
  region     = data.aws_region.current.name
  account_id = data.aws_caller_identity.current.account_id

  # Standard ARN templates. Region-scoped because each region has its
  # own subscription resource (Security Hub is regional). Subscription
  # ARNs use empty account segment (`::`); control ARNs are
  # subscription-account-scoped.
  standard_arns = {
    "aws-foundational" = "arn:${local.partition}:securityhub:${local.region}::standards/aws-foundational-security-best-practices/v/1.0.0"
    "cis-v1.4.0"       = "arn:${local.partition}:securityhub:${local.region}::standards/cis-aws-foundations-benchmark/v/1.4.0"
    "pci-dss"          = "arn:${local.partition}:securityhub:${local.region}::standards/pci-dss/v/3.2.1"
    "nist-800-53"      = "arn:${local.partition}:securityhub:${local.region}::standards/nist-800-53/v/5.0.0"
  }

  # Subscription ARNs (per-account, used for control ARN construction).
  subscription_arns = {
    "aws-foundational" = "arn:${local.partition}:securityhub:${local.region}:${local.account_id}:subscription/aws-foundational-security-best-practices/v/1.0.0"
    "cis-v1.4.0"       = "arn:${local.partition}:securityhub:${local.region}:${local.account_id}:subscription/cis-aws-foundations-benchmark/v/1.4.0"
    "pci-dss"          = "arn:${local.partition}:securityhub:${local.region}:${local.account_id}:subscription/pci-dss/v/3.2.1"
    "nist-800-53"      = "arn:${local.partition}:securityhub:${local.region}:${local.account_id}:subscription/nist-800-53/v/5.0.0"
  }

  base_tags = merge(var.tags, {
    Module    = "security-hub"
    Component = "security-detection"
  })

  # Map of "<standard>:<control_id>" -> object for_each.
  disabled_controls = { for c in var.auto_disabled_controls : "${c.standard}:${c.control_id}" => c }

  enabled_standards = merge(
    var.enable_aws_foundational ? { "aws-foundational" = local.standard_arns["aws-foundational"] } : {},
    var.enable_cis_v1_4_0 ? { "cis-v1.4.0" = local.standard_arns["cis-v1.4.0"] } : {},
    var.enable_pci_dss ? { "pci-dss" = local.standard_arns["pci-dss"] } : {},
    var.enable_nist_800_53 ? { "nist-800-53" = local.standard_arns["nist-800-53"] } : {},
  )
}

############################################
# Account subscription (bootstrap path only).
############################################

resource "aws_securityhub_account" "this" {
  count = var.create_account_subscription ? 1 : 0

  enable_default_standards = var.enable_default_standards
}

############################################
# Standards subscriptions.
#
# `for_each` over the enabled-standards map produces one subscription
# per standard. The subscription is idempotent against the org-managed
# state: if the standard was already enabled by a member auto-enable,
# Terraform imports the existing subscription on first plan/import.
############################################

resource "aws_securityhub_standards_subscription" "this" {
  for_each = local.enabled_standards

  standards_arn = each.value

  depends_on = [aws_securityhub_account.this]
}

############################################
# Wait for standards subscription bootstrap.
#
# CC-18 (S5-2 iter 2): `aws_securityhub_standards_control` requires
# the subscription to have COMPLETED enabling its controls (eventually
# consistent: ~5-10 min after first apply on cold-start). Without this
# barrier the first `terraform apply` would fail with "control not
# found" on `aws_securityhub_standards_control` resources, requiring a
# second apply (NEW-FINDING #4 from iter 1).
#
# 60s is conservative for warm subscriptions (already-enabled
# standards re-imported by Terraform); cold bootstrap may still need a
# follow-up apply but the time_sleep absorbs the common case.
############################################

resource "time_sleep" "wait_for_standards" {
  depends_on = [aws_securityhub_standards_subscription.this]

  create_duration = "60s"
}

############################################
# Disabled controls.
#
# Build the per-control ARN from standard subscription + control id.
# AWS encodes this as:
#   arn:aws:securityhub:<region>:<account>:control/<standard-key>/v/<ver>/<control-id>
# We rely on `aws_securityhub_standards_control` resource to look up
# the control by `standards_control_arn` (the data plane API returns
# the ARN once the standard is enabled).
############################################

resource "aws_securityhub_standards_control" "disabled" {
  for_each = local.disabled_controls

  # Control ARN format:
  #   arn:<partition>:securityhub:<region>:<account>:control/<standard>/v/<ver>/<control_id>
  # Derived from subscription_arns by swapping ":subscription/" → ":control/"
  # and appending /<control_id>.
  standards_control_arn = "${replace(local.subscription_arns[each.value.standard], ":subscription/", ":control/")}/${each.value.control_id}"
  control_status        = "DISABLED"
  disabled_reason       = each.value.reason

  depends_on = [
    aws_securityhub_standards_subscription.this,
    time_sleep.wait_for_standards,
  ]
}

############################################
# Cross-region aggregator (optional).
#
# Iter 1 only single region, but ship the resource so iter 2+ can
# enable with a single bool flip.
############################################

resource "aws_securityhub_finding_aggregator" "this" {
  count = var.enable_aggregator ? 1 : 0

  linking_mode = var.aggregator_linking_mode
  specified_regions = var.aggregator_linking_mode == "ALL_REGIONS" ? null : var.aggregator_specified_regions

  depends_on = [aws_securityhub_account.this, aws_securityhub_standards_subscription.this]
}
