# module/waf-web-acl

WAFv2 Web ACL con AWS Managed Rules (OWASP Top 10 baseline + reputation), rate-based per-IP y logging redactado a Firehose / CloudWatch. Cumple **RNF-SEC-05** (audit Sprint 1) y la story **S3-10**.

## Qué bloquea

| Rule group | Cobertura | Acción default |
|---|---|---|
| `AWSManagedRulesCommonRuleSet` | OWASP Top 10 baseline (XSS, LFI, RFI, body size) | BLOCK |
| `AWSManagedRulesKnownBadInputsRuleSet` | Patrones conocidos de exploits (CVEs, JNDI, log4shell) | BLOCK |
| `AWSManagedRulesSQLiRuleSet` | SQL injection (URI, body, headers, query string) | BLOCK |
| `AWSManagedRulesAmazonIpReputationList` | IPs en blacklists internas de AWS | BLOCK |
| `AWSManagedRulesAnonymousIpList` | Tor exit nodes, hosting providers, VPN comerciales | **COUNT** (override; ver abajo) |
| `rate-limit-per-ip` | 100 req/min/IP por default (configurable) | BLOCK |

> El default action del Web ACL es `allow`: lo que no matchea ninguna rule pasa. WAF NO es allowlist.

## Por qué AnonymousIpList está en COUNT, no BLOCK

Audit Sprint 1: muchos hospitales-cliente usan VPN corporativa (Cisco AnyConnect, Palo Alto GlobalProtect) que cae en este rule group. Bloquear sin un baseline de tráfico tiraría operativa legítima. Plan:

1. Deploy con `anonymous_ip_action = "count"` (default).
2. Tras 30 días, revisar CloudWatch metric `AWSManagedRulesAnonymousIpList` y muestras de logs.
3. Si <0.1% de tráfico legítimo cae en COUNT → promover a BLOCK con doble firma CISO.
4. Si >0.1% → ajustar excepciones (`scope_down_statement`) o dejar permanente en COUNT.

## Inputs

| Name | Type | Default | Notes |
|------|------|---------|-------|
| `name` | string | — | `segurasist-<env>-<scope_name>` |
| `scope` | string | `REGIONAL` | `REGIONAL` (App Runner) o `CLOUDFRONT` (Amplify; requiere provider us-east-1) |
| `rate_limit_per_5min` | number | `500` | ≈100 req/min/IP. Threshold WAFv2 nativo (ventana fija 5min) |
| `rate_limit_per_ip` | number | `null` | Alias semántico (req/min). Si != null sobrescribe `rate_limit_per_5min` |
| `managed_rule_groups` | list(string) | 5 default | Orden = priority |
| `anonymous_ip_action` | string | `count` | `count` o `block` |
| `log_destination_arn` | string | `null` | Firehose `aws-waf-logs-*` ó CW Log Group `aws-waf-logs-*` |
| `log_retention_days` | number | `90` | Reservado (lo aplica el caller en el Log Group) |
| `redacted_header_names` | list(string) | `["authorization","cookie"]` | Headers redactados antes de salir a logs |
| `tags` | map(string) | `{}` | — |

## Outputs

- `web_acl_arn` — para `aws_apprunner_service.waf_web_acl_arn` o `aws_cloudfront_distribution.web_acl_id`
- `web_acl_id`, `web_acl_name`, `web_acl_capacity`
- `logging_configured` — `bool`

## Ejemplo: REGIONAL (App Runner mx-central-1)

```hcl
resource "aws_cloudwatch_log_group" "waf_api" {
  name              = "aws-waf-logs-segurasist-prod-api"
  retention_in_days = 90
  kms_key_id        = module.kms_general.key_arn
}

module "waf_api" {
  source = "../../modules/waf-web-acl"

  name                = "segurasist-prod-api-waf"
  scope               = "REGIONAL"
  rate_limit_per_ip   = 100
  log_destination_arn = aws_cloudwatch_log_group.waf_api.arn

  tags = { Component = "waf-api" }
}

# Asociación con App Runner:
resource "aws_apprunner_service" "api" {
  # ...
  web_acl_arn = module.waf_api.web_acl_arn
}
```

## Ejemplo: CLOUDFRONT (Amplify Hosting; us-east-1)

```hcl
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

resource "aws_cloudwatch_log_group" "waf_cf" {
  provider          = aws.us_east_1
  name              = "aws-waf-logs-segurasist-prod-cf"
  retention_in_days = 90
  kms_key_id        = module.kms_general_us_east_1.key_arn
}

module "waf_cloudfront" {
  source    = "../../modules/waf-web-acl"
  providers = { aws = aws.us_east_1 }

  name                = "segurasist-prod-cf-waf"
  scope               = "CLOUDFRONT"
  rate_limit_per_ip   = 200  # Web traffic (Amplify) tolera más burst que API
  log_destination_arn = aws_cloudwatch_log_group.waf_cf.arn

  tags = { Component = "waf-cloudfront" }
}
```

## Costos estimados (us-east-1 / mx-central-1, abril 2026)

- **Web ACL**: $5.00 / mes
- **Managed rule groups**: $1.00 / rule group / mes (5 groups → $5.00 / mes)
- **Custom rule (rate-based)**: $1.00 / mes
- **Requests**: $0.60 por **millón** de requests evaluadas

Estimación SegurAsist MVP (10k req/día / WAF):

| Componente | Costo / mes |
|---|---|
| Web ACL REGIONAL (App Runner mx-central-1) | $5 + $5 + $1 = **$11** |
| Web ACL CLOUDFRONT (Amplify, us-east-1) | $5 + $5 + $1 = **$11** |
| Requests (~600k req/mes) | $0.36 |
| Logging Firehose (10 GB/mes a S3) | ~$0.30 |
| **Total WAF / mes** | **~$23 / mes** |

A escala 1M req/mes: **~$24 / mes**. A 10M req/mes: **~$30 / mes**. WAF escala bien.

## Limitations / known issues

- `rate_based_statement` en WAFv2 sólo soporta ventana fija de **5 minutos**. Para ventanas más cortas (anti-bruteforce login en 1min) se usa el **Throttler aplicación-level** (S3-10 backend).
- `rate_based_statement` no soporta agregación por `tenant`. La defensa per-tenant vive en el Throttler aplicación (`@TenantThrottle`). El roadmap Sprint 5 evalúa `aws_wafv2_web_acl` con `label_match_statement` + Lambda@Edge para inyectar un label `tenant:<id>` y aplicar rate-limit per-tenant, pero el costo operacional no justifica para MVP.
- `AWSManagedRulesAnonymousIpList` puede estar desactualizado en hasta 24h respecto a la base de IPs anónimas — no usar como sole defense.

## Referencias

- `docs/security/waf-managed-rules.md` — tabla detallada de rules + falsos positivos comunes.
- `docs/runbooks/RB-016-waf-rules.md` — runbook ante WAF block legítimo (renumerado desde `RB-012` en F8 iter 2).
- ADR-014 (mx-central-1 primary) + ADR-012 (us-east-1 DR).
