# module/apprunner-service

App Runner service con VPC connector, X-Ray, autoscaling, secrets desde Secrets Manager,
KMS encryption, y asociación opcional a WAF.

## Inputs principales

| Name | Type | Default |
|------|------|---------|
| service_name | string | — |
| image_uri | string | — |
| ecr_repository_arn | string | — |
| cpu | string | `1024` |
| memory | string | `2048` |
| port | number | `3000` |
| health_check | object | `/health/ready`, 10s |
| auto_scaling | object | min=1, max=10, max_concurrency=100 |
| vpc_connector_arn | string | — |
| observability_enabled | bool | `true` |
| env_vars | map(string) | `{}` |
| secrets | map(string) | `{}` (env name -> SM/SSM ARN) |
| kms_key_arn | string | — |
| waf_web_acl_arn | string | `null` |
| auto_deployments_enabled | bool | `false` |

## Outputs

- `service_arn`, `service_id`, `service_url`, `instance_role_arn`, `ecr_access_role_arn`

## Ejemplo

```hcl
module "apprunner_api" {
  source = "../../modules/apprunner-service"

  service_name      = "segurasist-dev-api"
  image_uri         = "${data.aws_caller_identity.current.account_id}.dkr.ecr.mx-central-1.amazonaws.com/segurasist-api:${var.image_tag}"
  ecr_repository_arn = aws_ecr_repository.api.arn
  vpc_connector_arn = aws_apprunner_vpc_connector.this.arn
  kms_key_arn       = module.kms_general.key_arn

  env_vars = {
    NODE_ENV   = "production"
    AWS_REGION = "mx-central-1"
    LOG_LEVEL  = "info"
  }

  secrets = {
    DATABASE_URL = "${module.rds_main.master_user_secret_arn}:url::"
  }

  waf_web_acl_arn = module.waf_api.web_acl_arn

  tags = { Env = "dev", Component = "api" }
}
```
