data "aws_caller_identity" "current" {}

############################################
# Organizations + OUs
############################################

resource "aws_organizations_organization" "this" {
  feature_set = var.organization_feature_set

  aws_service_access_principals = var.enabled_aws_service_principals
  enabled_policy_types          = ["SERVICE_CONTROL_POLICY", "TAG_POLICY", "BACKUP_POLICY"]
}

resource "aws_organizations_organizational_unit" "this" {
  for_each = var.ous

  name      = each.key
  parent_id = aws_organizations_organization.this.roots[0].id

  tags = { OU = each.key, Description = each.value }
}

############################################
# SCPs (loaded from JSON files)
############################################

locals {
  scp_files = {
    "deny-region-restriction"      = "${path.module}/scps/deny-region-restriction.json"
    "deny-disable-guardduty-sh"    = "${path.module}/scps/deny-disable-guardduty-sh.json"
    "deny-iam-user-creation"       = "${path.module}/scps/deny-iam-user-creation.json"
    "deny-s3-public-and-unenc"     = "${path.module}/scps/deny-s3-public-and-unenc.json"
    "deny-s3-object-lock-delete"   = "${path.module}/scps/deny-s3-object-lock-delete.json"
  }
}

resource "aws_organizations_policy" "scp" {
  for_each = local.scp_files

  name        = "segurasist-${each.key}"
  description = "SegurAsist SCP: ${each.key}"
  type        = "SERVICE_CONTROL_POLICY"
  content     = templatefile(each.value, { allowed_regions = jsonencode(var.allowed_regions) })

  tags = { Type = "SCP" }
}

# Attach all SCPs to the Workloads OU (dev, staging, prod).
resource "aws_organizations_policy_attachment" "workloads" {
  for_each = aws_organizations_policy.scp

  policy_id = each.value.id
  target_id = aws_organizations_organizational_unit.this["Workloads"].id
}

# Attach the audit-protection SCPs to the Security OU as well.
resource "aws_organizations_policy_attachment" "security" {
  for_each = {
    for k, v in aws_organizations_policy.scp : k => v
    if contains(["deny-disable-guardduty-sh", "deny-iam-user-creation", "deny-s3-public-and-unenc", "deny-s3-object-lock-delete"], k)
  }

  policy_id = each.value.id
  target_id = aws_organizations_organizational_unit.this["Security"].id
}

############################################
# IAM Identity Center (assumes already enabled in mgmt account)
############################################

data "aws_ssoadmin_instances" "this" {}
