# module/sqs-queue

SQS queue con DLQ obligatoria (3 receives default), SSE-KMS y redrive policy + redrive
allow policy en la DLQ.

## Inputs principales

| Name | Type | Default |
|------|------|---------|
| name | string | — |
| fifo_queue | bool | `false` |
| visibility_timeout_seconds | number | `60` |
| message_retention_seconds | number | `345600` (4d) |
| receive_wait_time_seconds | number | `20` (long polling) |
| kms_key_arn | string | — |
| max_receive_count | number | `3` |
| dlq_message_retention_seconds | number | `1209600` (14d) |

## Outputs

- `queue_arn`, `queue_url`, `queue_name`, `dlq_arn`, `dlq_url`, `dlq_name`

## Ejemplo

```hcl
module "sqs_certificates" {
  source      = "../../modules/sqs-queue"
  name        = "segurasist-dev-certificates"
  kms_key_arn = module.kms_general.key_arn
  visibility_timeout_seconds = 120

  tags = { Env = "dev", Component = "queues" }
}
```
