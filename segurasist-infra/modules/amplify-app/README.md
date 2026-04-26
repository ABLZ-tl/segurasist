# module/amplify-app

Amplify Hosting app (`WEB_COMPUTE` por default para Next.js SSR), branches con auto-build,
custom domain con sub-domains por branch, custom rewrite rules (SPA fallback default), y
optional basic-auth gating para previews.

El token de GitHub se lee de Secrets Manager (key `token` dentro del secret JSON) — NO se
hardcodea.

## Inputs principales

| Name | Type | Default |
|------|------|---------|
| name | string | — |
| repository | string | — |
| platform | string | `WEB_COMPUTE` |
| build_spec | string | `null` (usa amplify.yml del repo) |
| github_oauth_token_secret_arn | string | — |
| environment_variables | map(string) | `{}` |
| branches | map(object) | `{}` |
| custom_domain | object | `null` |
| custom_rules | list(object) | SPA fallback |
| enable_basic_auth | bool | `false` |

## Outputs

- `app_id`, `app_arn`, `default_domain`, `branch_arns`

## Ejemplo

```hcl
module "amplify_admin" {
  source     = "../../modules/amplify-app"
  name       = "segurasist-dev-admin"
  repository = "https://github.com/segurasist/segurasist-web"
  github_oauth_token_secret_arn = aws_secretsmanager_secret.github_oauth.arn

  environment_variables = {
    NEXT_PUBLIC_API_URL = "https://api.dev.segurasist.app"
  }

  branches = {
    "main" = { stage = "DEVELOPMENT", framework = "Next.js - SSR" }
  }

  custom_domain = {
    domain_name = "segurasist.app"
    sub_domains = [
      { branch_name = "main", prefix = "admin.dev" }
    ]
  }

  tags = { Env = "dev", Component = "amplify-admin" }
}
```
