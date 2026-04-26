# module/vpc

VPC /16 con 3 AZs, 3 capas de subnets (public, private-app, private-data), NAT Gateway
configurable (single o HA), VPC Endpoints (Gateway: S3, DynamoDB; Interface: KMS, SM, SQS,
SES, ECR, Logs, EventBridge, Cognito-IDP), security groups del data + control plane, y
flow logs a CloudWatch.

## Inputs principales

| Name | Type | Default | Notes |
|------|------|---------|-------|
| name_prefix | string | n/a | `segurasist-{env}` |
| cidr_block | string | `10.0.0.0/16` | |
| azs | list(string) | n/a | Exactly 3 AZs required |
| public_subnet_cidrs | map(string) | n/a | AZ -> CIDR |
| private_app_subnet_cidrs | map(string) | n/a | |
| private_data_subnet_cidrs | map(string) | n/a | |
| enable_nat_high_availability | bool | `false` | `true` = 1 NAT/AZ |
| enable_flow_logs | bool | `true` | |
| interface_endpoints | list(string) | KMS, SM, SQS, SES, ECR, Logs, Events, Cognito-IDP | |
| tags | map(string) | `{}` | |

## Outputs principales

- `vpc_id`, `vpc_cidr_block`
- `public_subnet_ids`, `private_app_subnet_ids`, `private_data_subnet_ids` (maps AZ -> id)
- `sg_alb_id`, `sg_apprunner_id`, `sg_lambda_vpc_id`, `sg_rds_id`, `sg_redis_id`, `sg_bastion_id`, `sg_vpce_id`
- `nat_gateway_ids`

## Ejemplo de uso

```hcl
module "vpc" {
  source = "../../modules/vpc"

  name_prefix = "segurasist-dev"
  cidr_block  = "10.10.0.0/16"
  azs         = ["mx-central-1a", "mx-central-1b", "mx-central-1c"]

  public_subnet_cidrs = {
    "mx-central-1a" = "10.10.0.0/24"
    "mx-central-1b" = "10.10.1.0/24"
    "mx-central-1c" = "10.10.2.0/24"
  }

  private_app_subnet_cidrs = {
    "mx-central-1a" = "10.10.10.0/24"
    "mx-central-1b" = "10.10.11.0/24"
    "mx-central-1c" = "10.10.12.0/24"
  }

  private_data_subnet_cidrs = {
    "mx-central-1a" = "10.10.20.0/24"
    "mx-central-1b" = "10.10.21.0/24"
    "mx-central-1c" = "10.10.22.0/24"
  }

  enable_nat_high_availability = false   # dev cost-conscious

  tags = { Env = "dev" }
}
```
