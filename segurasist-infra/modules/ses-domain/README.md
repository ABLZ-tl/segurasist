# module/ses-domain

SES v2 domain identity con DKIM RSA-2048, MAIL FROM con MX + SPF (REJECT on MX failure),
domain SPF, DMARC (default `quarantine`, `adkim=s`, `aspf=s`), Configuration Set TLS REQUIRE
con reputation metrics, y SNS event destination para bounce/complaint/delivery.

Crea automáticamente los registros DNS en la Route53 zone provista.

## Inputs principales

| Name | Type | Default |
|------|------|---------|
| domain | string | — |
| route53_zone_id | string | — |
| mail_from_subdomain | string | `bounce` |
| dmarc_policy | string | `quarantine` |
| dmarc_rua | string | `null` |
| configuration_set_name | string | — |
| tls_policy | string | `REQUIRE` |
| reputation_metrics_enabled | bool | `true` |
| sns_topic_arn | string | — |

## Outputs

- `identity_arn`, `configuration_set_name`, `dkim_tokens`, `mail_from_domain`

## Ejemplo

```hcl
module "ses_segurasist" {
  source                 = "../../modules/ses-domain"
  domain                 = "segurasist.app"
  route53_zone_id        = aws_route53_zone.primary.zone_id
  configuration_set_name = "segurasist-dev-cs"
  sns_topic_arn          = aws_sns_topic.ses_events.arn
  dmarc_rua              = "mailto:dmarc@segurasist.app"

  tags = { Env = "dev", Component = "email" }
}
```
