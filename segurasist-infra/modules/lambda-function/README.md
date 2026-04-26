# module/lambda-function

Lambda genérico Node 20 (arm64 default) con DLQ SQS obligatoria, X-Ray Active, log group
con retention configurable, KMS para env-vars y DLQ, soporte VPC opcional, layers (e.g.,
Chromium para PDF), reserved concurrency configurable, e IAM statements adicionales.

`filename`, `s3_key`, `image_uri` están en `lifecycle.ignore_changes`: Terraform crea la
función con un placeholder y CI/CD publica versiones reales.

## Inputs principales

| Name | Type | Default |
|------|------|---------|
| function_name | string | — |
| runtime | string | `nodejs20.x` |
| handler | string | `index.handler` |
| package_type | string | `Zip` (also `Image`) |
| memory_size | number | `512` |
| timeout | number | `30` |
| architectures | list(string) | `["arm64"]` |
| kms_key_arn | string | — |
| vpc_config | object | `null` |
| layers | list(string) | `[]` |
| reserved_concurrency | number | `-1` |
| log_retention_days | number | `30` |
| additional_iam_statements | list(any) | `[]` |

## Outputs

- `function_name`, `function_arn`, `function_invoke_arn`
- `execution_role_arn`, `execution_role_name`
- `dlq_arn`, `dlq_url`, `log_group_name`

## Ejemplo

```hcl
module "lambda_pdf" {
  source = "../../modules/lambda-function"

  function_name = "segurasist-dev-pdf-renderer"
  description   = "Renders certificate PDFs via Chromium"
  memory_size   = 2048
  timeout       = 60
  layers        = [data.aws_lambda_layer_version.chromium.arn]

  kms_key_arn = module.kms_general.key_arn

  vpc_config = {
    subnet_ids         = module.vpc.private_app_subnet_id_list
    security_group_ids = [module.vpc.sg_lambda_vpc_id]
  }

  reserved_concurrency = 50
  log_retention_days   = 30

  tags = { Env = "dev", Component = "lambda-pdf" }
}
```
