# WAF Managed Rules — catálogo y excepciones

> Referencia operativa para `segurasist-infra/modules/waf-web-acl`.
> Owner: AppSec / DevOps.
> Última actualización: 2026-04-25 — Sprint 3 S3-10.

Este documento explica, por cada AWS Managed Rule Group activado en el módulo, **qué bloquea**, **falsos positivos comunes** y el **procedimiento para agregar una excepción**.

## Mapa de rule groups

| Rule group | Priority | Acción default | Web ACL scope |
|---|---|---|---|
| `AWSManagedRulesCommonRuleSet` | 1 | BLOCK (varios) / COUNT (varios) | REGIONAL + CLOUDFRONT |
| `AWSManagedRulesKnownBadInputsRuleSet` | 2 | BLOCK | REGIONAL + CLOUDFRONT |
| `AWSManagedRulesSQLiRuleSet` | 3 | BLOCK | REGIONAL + CLOUDFRONT |
| `AWSManagedRulesAmazonIpReputationList` | 4 | BLOCK | REGIONAL + CLOUDFRONT |
| `AWSManagedRulesAnonymousIpList` | 5 | **COUNT** (override) | REGIONAL + CLOUDFRONT |
| `rate-limit-per-ip` (custom) | 15 | BLOCK | REGIONAL (100/min) + CLOUDFRONT (200/min) |

## Detalle por rule group

### 1. AWSManagedRulesCommonRuleSet (CRS)

**Cobertura**: OWASP Top 10 baseline. Incluye sub-rules para:
- `NoUserAgent_HEADER` — bloquea requests sin User-Agent.
- `UserAgent_BadBots_HEADER` — bloquea User-Agents conocidos de bots.
- `SizeRestrictions_*` — bloquea body/query/cookie/header excesivamente grandes.
- `EC2MetaDataSSRF_*` — bloquea intentos de SSRF al metadata endpoint.
- `GenericLFI_*` — Local File Inclusion.
- `GenericRFI_*` — Remote File Inclusion.
- `RestrictedExtensions_*` — bloquea `.php`, `.asp`, `.bat`, etc.
- `CrossSiteScripting_*` — XSS reflejado.

**Falsos positivos comunes en SegurAsist**:

| Sub-rule | Caso | Mitigación |
|---|---|---|
| `SizeRestrictions_BODY` | Upload XLSX `/v1/batches` > 8KB body | El módulo permite tamaños grandes para multipart; si llega: `rule_action_override` a COUNT en CRS para esta sub-rule. |
| `NoUserAgent_HEADER` | Cliente M2M (curl en cron interno) sin UA | NO desactivar globalmente. Setear UA explícito en el cliente. |
| `EC2MetaDataSSRF_BODY` | Algún payload con substring `169.254.169.254` (raro) | Si aparece: COUNT + alerta interna. |

**Procedimiento de excepción**: ver § Procedimiento general más abajo.

### 2. AWSManagedRulesKnownBadInputsRuleSet

**Cobertura**: payloads vinculados a CVEs públicos:
- Log4Shell (`${jndi:ldap://...}`).
- ProxyLogon (Exchange CVE-2021-26855).
- Spring4Shell.
- Strings característicos de webshells (china chopper, etc.).

**Falsos positivos esperados**: ninguno conocido. Si aparece, **trate como REAL primero** y abra investigación.

### 3. AWSManagedRulesSQLiRuleSet

**Cobertura**: SQL injection en URI, query string, body, headers, cookies. Detecta:
- `' OR 1=1`, `UNION SELECT`, `; DROP TABLE`.
- Encodings comunes (`%27`, `%20OR%20`).
- Comentarios SQL (`--`, `/* */`).

**Falsos positivos comunes en SegurAsist**:

| Caso | Mitigación |
|---|---|
| Operador busca por nombre con apóstrofo (`O'Brien`) → query a `/v1/insureds?search=O'Brien` | El backend usa Prisma con bound params; la entrada puede pasar URL-encoded sin trigger. Si ocurre: `rule_action_override` a COUNT en `SQLi_QUERYARGUMENTS`. |
| Body JSON con campo `"notes": "1; comentario"` | Cubre el `SQLi_BODY` por colisión con sintaxis SQL. Override COUNT si recurrente. |

### 4. AWSManagedRulesAmazonIpReputationList

**Cobertura**: IPs identificadas por AWS (Internal threat intel + GuardDuty + abuse reports) como fuentes de:
- Bots maliciosos.
- Hosts comprometidos.
- C&C de botnets.

Updated continuamente por AWS, no por nosotros.

**Falsos positivos esperados**: ocasional (un MAC desde un ISP cuya IP rotó de un actor malicioso anterior). Mitigación: IP allowlist explícita (ver runbook RB-016).

### 5. AWSManagedRulesAnonymousIpList

**Cobertura**: Tor exit nodes, hosting providers (DigitalOcean, OVH, Hetzner...), VPN comerciales (NordVPN, ExpressVPN, ProtonVPN...).

**Acción actual**: `count` — **NO BLOQUEA**. Solo registra para análisis.

**Por qué COUNT y no BLOCK**:
- Audit Sprint 1: muchos hospitales-cliente usan VPN corporativa que cae en este rule group.
- Bloquear sin baseline de tráfico real tiraría operativa legítima.

**Plan de promoción a BLOCK**:
1. T+0 (Sprint 5 deploy): `count`.
2. T+30d: revisar metric `AWSManagedRulesAnonymousIpList` y muestras.
3. Si <0.1% del tráfico legítimo cae en COUNT → promover a BLOCK con doble firma CISO.
4. Si >0.1% → identificar VPN allowlist (ej. AS de Cisco AnyConnect MAC) y bloquear el resto.

### 6. rate-limit-per-ip (custom)

**Cobertura**: rate-based statement nativo de WAFv2.
- REGIONAL: 500 req/5min ≈ 100 req/min/IP.
- CLOUDFRONT: 1000 req/5min ≈ 200 req/min/IP.

**Falsos positivos**: ver runbook RB-016 § Caso especial. Solución típica: IP set allowlist para MACs con NAT corporativo (todos sus operadores comparten 1 IP).

> Esta rule es complementaria al **Throttler aplicación-level** (ventana 1min, key user-IP + tenant). El WAF cubre el peor caso (volumetría descontrolada); el Throttler cubre granularidad fina (per-user, per-tenant, per-route).

## Procedimiento general para agregar una excepción

Toda excepción a una rule managed (override BLOCK→COUNT, exclusión de sub-rule, IP allowlist) requiere:

1. **PR en `segurasist-infra`** con el cambio bajo `module.waf_api` o `module.waf_cloudfront`.
2. **Comentario CISO en el PR** aprobando la excepción (sin esto, NO mergear). Formato:
   ```
   /excepción-aprobada
   Rule: AWSManagedRulesCommonRuleSet/SizeRestrictions_BODY
   Justificación: uploads XLSX legítimos > umbral por feature batches.
   Compensación: validación magic-bytes + size cap en backend (BatchesController.upload).
   Reevaluar: 2026-Q3.
   Firma: <CISO handle>
   ```
3. **Entrada en este documento** bajo § "Excepciones vigentes" (abajo).
4. **Smoke test post-deploy**: reproducir el payload que motivó la excepción y verificar que pasa.
5. **Revisión trimestral** (Tech Lead + CISO): toda excepción que tenga > 90 días sin revisión se asume como deuda y va al backlog de seguridad.

## Excepciones vigentes

| Fecha | Web ACL | Rule | Razón | Firma CISO | Reevaluar |
|---|---|---|---|---|---|
| 2026-04-25 | api + cf | `AWSManagedRulesAnonymousIpList` (override COUNT) | Hospitales con VPN corporativa | TBD (Sprint 5 deploy) | 2026-Q3 |

## Costos estimados

| Componente | Costo / mes |
|---|---|
| Web ACL (REGIONAL) | $5 |
| 5 managed rule groups | $5 ($1 c/u) |
| 1 custom rule (rate-limit-per-ip) | $1 |
| Web ACL (CLOUDFRONT) | $5 |
| 5 managed rule groups (CF) | $5 |
| 1 custom rule (CF rate-limit) | $1 |
| Requests evaluadas (~1M/mes) | $0.60 |
| Logs (Firehose + S3, ~10GB/mes) | ~$0.30 |
| **Total mensual** | **~$23** |

Escala lineal: a 10M req/mes total ~$30/mes; a 100M req/mes ~$80/mes.

## Referencias

- `segurasist-infra/modules/waf-web-acl/README.md`
- `segurasist-infra/docs/runbooks/RB-016-waf-rules.md` (renumerado desde `RB-012` en F8 iter 2)
- AWS: [Best practices for AWS Managed Rules](https://docs.aws.amazon.com/waf/latest/developerguide/waf-managed-rule-best-practices.html)
- OWASP CRS: https://coreruleset.org/ (referencia conceptual; AWS CRS es propio)
