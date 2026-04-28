# eventbridge-rule

Schedule-based EventBridge rule (cron) → SQS or Lambda target.

Used by Sprint 4 / S4-04 to fire the monthly reports cron the 1st of every
month at 14:00 UTC (≈ 08:00 CST). The target is the `monthly-reports` SQS
queue declared in `envs/{env}/main.tf`; the NestJS API consumes it via
`MonthlyReportsHandlerService` with DB-side idempotency through the
`monthly_report_runs` table (UNIQUE `tenant_id, period_year, period_month`).

## Inputs

| Name | Type | Default | Notes |
|---|---|---|---|
| `name` | string | — | Rule name (also tag prefix). |
| `cron_expression` | string | `cron(0 14 1 * ? *)` | Must match `cron(...)`/`rate(...)`. UTC only. |
| `target_sqs_arn` | string | `null` | Set for SQS target. |
| `target_lambda_arn` | string | `null` | Set for Lambda target (mutually exclusive). |
| `enabled` | bool | `true` | Disable in dev when refactoring. |

## Coordination

- The caller env declares the SQS queue policy that allows
  `events.amazonaws.com` to `sqs:SendMessage` on the target queue. This
  module does NOT manage that policy because the SQS queue is owned by
  the `sqs-queue` module and the policy attachment lives at env-level
  (so the same queue can accept multiple rules).
- The CloudWatch alarm `eventbridge-rule-failed-invocations > 0` is wired
  in `envs/{env}/alarms.tf` (extends F8 alarms set).
