resource "aws_ssoadmin_permission_set" "this" {
  instance_arn     = var.instance_arn
  name             = var.name
  description      = var.description
  session_duration = var.session_duration

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_ssoadmin_managed_policy_attachment" "this" {
  for_each = toset(var.managed_policies)

  instance_arn       = var.instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.this.arn
  managed_policy_arn = each.value
}

resource "aws_ssoadmin_customer_managed_policy_attachment" "this" {
  for_each = { for p in var.customer_managed_policies : p.name => p }

  instance_arn       = var.instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.this.arn

  customer_managed_policy_reference {
    name = each.value.name
    path = each.value.path
  }
}

resource "aws_ssoadmin_permission_set_inline_policy" "this" {
  count = var.inline_policy == null ? 0 : 1

  instance_arn       = var.instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.this.arn
  inline_policy      = var.inline_policy
}

resource "aws_ssoadmin_permissions_boundary_attachment" "managed" {
  count = var.permissions_boundary != null && try(var.permissions_boundary.managed_policy_arn, null) != null ? 1 : 0

  instance_arn       = var.instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.this.arn

  permissions_boundary {
    managed_policy_arn = var.permissions_boundary.managed_policy_arn
  }
}

resource "aws_ssoadmin_permissions_boundary_attachment" "customer" {
  count = var.permissions_boundary != null && try(var.permissions_boundary.customer_managed, null) != null ? 1 : 0

  instance_arn       = var.instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.this.arn

  permissions_boundary {
    customer_managed_policy_reference {
      name = var.permissions_boundary.customer_managed.name
      path = var.permissions_boundary.customer_managed.path
    }
  }
}

resource "aws_ssoadmin_account_assignment" "this" {
  for_each = { for a in var.account_assignments : "${a.account_id}-${a.principal_id}" => a }

  instance_arn       = var.instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.this.arn
  principal_id       = each.value.principal_id
  principal_type     = each.value.principal_type
  target_id          = each.value.account_id
  target_type        = "AWS_ACCOUNT"
}
