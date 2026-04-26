locals {
  is_admin   = var.pool_kind == "admin"
  is_insured = var.pool_kind == "insured"

  # Admin pool: hard MFA (WebAuthn-grade via TOTP); Insured: optional MFA
  mfa_configuration = local.is_admin ? "ON" : "OPTIONAL"
}

resource "aws_cognito_user_pool" "this" {
  name                     = var.name
  deletion_protection      = var.deletion_protection
  mfa_configuration        = local.mfa_configuration
  auto_verified_attributes = ["email"]

  username_attributes      = ["email"]
  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length                   = var.password_policy.minimum_length
    require_lowercase                = var.password_policy.require_lowercase
    require_uppercase                = var.password_policy.require_uppercase
    require_numbers                  = var.password_policy.require_numbers
    require_symbols                  = var.password_policy.require_symbols
    temporary_password_validity_days = var.password_policy.temporary_password_validity_days
  }

  software_token_mfa_configuration {
    enabled = true
  }

  # SMS MFA for insured pool only
  dynamic "sms_configuration" {
    for_each = local.is_insured ? [1] : []
    content {
      external_id    = "${var.name}-sms"
      sns_caller_arn = aws_iam_role.sms[0].arn
    }
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
    dynamic "recovery_mechanism" {
      for_each = local.is_insured ? [1] : []
      content {
        name     = "verified_phone_number"
        priority = 2
      }
    }
  }

  user_pool_add_ons {
    advanced_security_mode = var.advanced_security_mode
  }

  admin_create_user_config {
    allow_admin_create_user_only = local.is_admin
  }

  schema {
    name                     = "tenant_id"
    attribute_data_type      = "String"
    mutable                  = true
    required                 = false
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 1
      max_length = 64
    }
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    mutable             = true
    required            = true
    string_attribute_constraints {
      min_length = 5
      max_length = 320
    }
  }

  dynamic "email_configuration" {
    for_each = var.ses_source_email_arn == null ? [] : [1]
    content {
      email_sending_account = "DEVELOPER"
      source_arn            = var.ses_source_email_arn
      reply_to_email_address = var.ses_reply_to_address
    }
  }

  tags = merge(var.tags, { Name = var.name, PoolKind = var.pool_kind })
}

############################################
# SMS role for insured pool
############################################

resource "aws_iam_role" "sms" {
  count = local.is_insured ? 1 : 0
  name  = "${var.name}-sms-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cognito-idp.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "sts:ExternalId" = "${var.name}-sms" } }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "sms" {
  count = local.is_insured ? 1 : 0
  name  = "${var.name}-sms-publish"
  role  = aws_iam_role.sms[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sns:Publish"]
      Resource = "*"
    }]
  })
}

############################################
# Domain (hosted UI)
############################################

resource "aws_cognito_user_pool_domain" "this" {
  count        = var.domain_prefix == null && var.custom_domain == null ? 0 : 1
  domain       = var.custom_domain == null ? var.domain_prefix : var.custom_domain.domain
  user_pool_id = aws_cognito_user_pool.this.id
  certificate_arn = var.custom_domain == null ? null : var.custom_domain.acm_certificate
}

############################################
# Groups
############################################

resource "aws_cognito_user_group" "this" {
  for_each = var.groups

  name         = each.key
  description  = each.value
  user_pool_id = aws_cognito_user_pool.this.id
}

############################################
# Resource servers + scopes
############################################

resource "aws_cognito_resource_server" "this" {
  for_each = var.resource_servers

  identifier   = each.key
  name         = each.value.name
  user_pool_id = aws_cognito_user_pool.this.id

  dynamic "scope" {
    for_each = { for s in each.value.scopes : s.name => s }
    content {
      scope_name        = scope.value.name
      scope_description = scope.value.description
    }
  }
}

############################################
# App clients
############################################

resource "aws_cognito_user_pool_client" "this" {
  for_each = var.app_clients

  name                                 = each.key
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = each.value.generate_secret
  callback_urls                        = each.value.callback_urls
  logout_urls                          = each.value.logout_urls
  allowed_oauth_flows                  = each.value.allowed_oauth_flows
  allowed_oauth_scopes                 = each.value.allowed_oauth_scopes
  allowed_oauth_flows_user_pool_client = each.value.allowed_oauth_flows_user_pool_client
  explicit_auth_flows                  = each.value.explicit_auth_flows
  supported_identity_providers         = each.value.supported_identity_providers
  access_token_validity                = each.value.access_token_validity_minutes
  id_token_validity                    = each.value.id_token_validity_minutes
  refresh_token_validity               = each.value.refresh_token_validity_days
  prevent_user_existence_errors        = each.value.prevent_user_existence_errors ? "ENABLED" : "LEGACY"

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

############################################
# SAML identity providers
############################################

resource "aws_cognito_identity_provider" "saml" {
  for_each = var.saml_providers

  user_pool_id  = aws_cognito_user_pool.this.id
  provider_name = each.key
  provider_type = "SAML"

  provider_details = each.value.metadata_url != null ? {
    MetadataURL = each.value.metadata_url
  } : {
    MetadataFile = each.value.metadata_file
  }

  attribute_mapping = {
    email = each.value.attribute_email
  }
}

############################################
# OIDC identity providers
############################################

resource "aws_cognito_identity_provider" "oidc" {
  for_each = var.oidc_providers

  user_pool_id  = aws_cognito_user_pool.this.id
  provider_name = each.key
  provider_type = "OIDC"

  provider_details = {
    client_id                 = each.value.client_id
    client_secret             = each.value.client_secret
    oidc_issuer               = each.value.issuer
    authorize_scopes          = each.value.authorize_scopes
    attributes_request_method = "GET"
  }

  attribute_mapping = {
    email    = "email"
    username = "sub"
  }
}
