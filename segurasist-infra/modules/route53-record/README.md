# module/route53-record

Wrapper liviano para A, AAAA, CNAME, TXT, MX y alias records (Amplify, ALB, CloudFront).

## Inputs

| Name | Type | Default |
|------|------|---------|
| zone_id | string | — |
| name | string | — |
| type | string | — |
| ttl | number | `300` |
| records | list(string) | `[]` |
| alias | object | `null` |
| set_identifier | string | `null` |
| health_check_id | string | `null` |

## Outputs

- `record_name`, `record_fqdn`

## Ejemplo (alias para Amplify)

```hcl
module "dns_admin" {
  source  = "../../modules/route53-record"
  zone_id = aws_route53_zone.primary.zone_id
  name    = "admin.segurasist.app"
  type    = "A"
  alias = {
    name                   = module.amplify_admin.default_domain
    zone_id                = data.aws_route53_zone.amplify.zone_id
    evaluate_target_health = false
  }
}
```
