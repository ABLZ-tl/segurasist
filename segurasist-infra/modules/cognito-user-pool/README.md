# module/cognito-user-pool

Cognito User Pool con dos modos:

- `admin`: MFA ON (TOTP/WebAuthn-grade), `admin_create_user_only=true`, advanced security ENFORCED.
- `insured`: MFA OPTIONAL (OTP email/SMS), self-service signup permitido.

Soporta groups, resource servers (OAuth2 scopes), app clients, e identity providers SAML/OIDC.

## Inputs principales

| Name | Type | Default |
|------|------|---------|
| name | string | — |
| pool_kind | string | `admin` (or `insured`) |
| domain_prefix | string | `null` |
| custom_domain | object | `null` (`{ domain, acm_certificate }`) |
| password_policy | object | min 12, mixed case + num + symbol |
| advanced_security_mode | string | `ENFORCED` |
| groups | map(string) | `{}` |
| resource_servers | map(object) | `{}` |
| app_clients | map(object) | `{}` |
| saml_providers | map(object) | `{}` |
| oidc_providers | map(object) | `{}` (sensitive) |
| ses_source_email_arn | string | `null` |

## Outputs

- `user_pool_id`, `user_pool_arn`, `user_pool_endpoint`
- `domain`, `app_client_ids`, `group_arns`, `resource_server_identifiers`

## Ejemplo

```hcl
module "cognito_admin" {
  source = "../../modules/cognito-user-pool"

  name      = "segurasist-dev-admin"
  pool_kind = "admin"

  groups = {
    "AdminMAC"           = "Admin Hospitales MAC"
    "Operador"           = "Operador altas/bajas"
    "AdminSegurAsist"    = "Admin SegurAsist"
    "Supervisor"         = "Supervisor lectura"
  }

  resource_servers = {
    "https://api.segurasist.app" = {
      name = "segurasist-api"
      scopes = [
        { name = "users:read",        description = "Read users" },
        { name = "certificates:write", description = "Issue certificates" },
      ]
    }
  }

  app_clients = {
    "admin-web" = {
      callback_urls       = ["https://admin.segurasist.app/auth/callback"]
      logout_urls         = ["https://admin.segurasist.app/auth/logout"]
      allowed_oauth_scopes = ["openid", "email", "profile", "https://api.segurasist.app/users:read"]
    }
  }

  tags = { Env = "dev", Component = "cognito" }
}
```
