# RB-012 — WAF block legítimo / managed rules tunables

- Severity: P2 (cliente afectado, no incidente sistémico)
- On-call SLA: acknowledge ≤ 1 h (business hours), resolve ≤ 8 h
- Owner: AppSec / DevOps on-call (escalación CISO para excepciones permanentes)
- Story origen: S3-10
- Modulo afectado: `segurasist-infra/modules/waf-web-acl`

> Numeración: `RB-011` se asignó a DAST en S2-08; este runbook toma `RB-012`.

## Symptom

Una de las siguientes señales:

- Un operador legítimo de un MAC reporta error "Acceso denegado / 403 from CloudFront" o "Forbidden" desde el portal admin / portal asegurado / API.
- Alarma CloudWatch `WAFBlockedRequests > N` dispara en `aws-waf-logs-segurasist-prod-api` o `aws-waf-logs-segurasist-prod-cf`.
- Spike en `BlockedRequests` metric del Web ACL (REGIONAL o CLOUDFRONT) sin un ataque público correspondiente.
- Ticket de soporte: "no puedo subir batch", "no puedo entrar al portal", "se cae la sesión cada 5 minutos".

## Detection

1. Confirmar el block en CloudWatch metrics:
   ```
   AWS/WAFV2 → WebACL=segurasist-prod-api-waf → BlockedRequests
   ```
   Mirar la dimensión `Rule` para identificar QUÉ rule disparó (típicamente `AWSManagedRulesCommonRuleSet`, `AWSManagedRulesSQLiRuleSet`, o `rate-limit-per-ip`).
2. Sample en console WAF:
   - AWS Console → WAF & Shield → Web ACLs → `segurasist-prod-api-waf` → tab `Sampled requests`.
   - Filtrar por `Action: Block`. Anotar: timestamp, source IP, URI, rule, body snippet.
3. Logs detallados (Firehose / CloudWatch Logs):
   ```bash
   aws logs filter-log-events \
     --log-group-name aws-waf-logs-segurasist-prod-api \
     --start-time $(date -v-1H +%s)000 \
     --filter-pattern '{ $.action = "BLOCK" }' \
     --max-items 50
   ```
   Cada evento trae `httpRequest.headers`, `terminatingRuleId`, `terminatingRuleMatchDetails`, `labels`. Headers `authorization` y `cookie` están **redactados** por config del módulo (intencional).

## Diagnosis

Para cada block, decidir:

### Caso A — Block REAL (= ataque)

Indicadores:
- Source IP en blacklists públicas (cruzar contra `ip:<addr>` en VirusTotal, AbuseIPDB).
- Patrón claramente malicioso: `' OR 1=1 --` en query string, `<script>` en body, paths `/wp-admin`, `/.env`.
- User-Agent fingerprint de bot (`sqlmap`, `nikto`, `python-requests`).
- Rate-based con cientos de req/seg desde un único IP.

**Acción**: NO tocar el WAF. Documentar en log de incidentes (`docs/security/incidents.md`). Si el ataque es persistente y afecta perf, considerar agregar el IP a un IP set en el WAF (`aws wafv2 create-ip-set`).

### Caso B — Block LEGÍTIMO (= falso positivo)

Indicadores:
- Source IP de un MAC conocido (rango de oficina cliente, AS de ISP corporativo).
- User-Agent del frontend SegurAsist (`SegurAsist-Admin/1.x` o `Mozilla/5.0` típico).
- Payload corresponde a una operación esperada (subir XLSX, alta de insured, fetch de batches).
- El usuario pudo reproducir el error.

**Acción**: tunear la rule (sección Recovery → Camino B).

### Caso especial — Rate limit per-IP

Si el `terminatingRuleId == "rate-limit-per-ip"` y el source IP es un MAC con NAT corporativo (todos sus operadores compartiendo una sola IP pública):

- Verificar que el Throttler aplicación (user-IP + tenant) NO esté ya bloqueando — si la app ya respeta `userId+IP`, los hits del WAF deberían distribuirse mejor.
- Considerar **excepción IP** vía IP set + `priority` menor que rate-limit:
  ```hcl
  rule {
    name     = "trusted-mac-bypass"
    priority = 5  # antes que rate-limit-per-ip (priority 15)
    action { allow {} }
    statement {
      ip_set_reference_statement {
        arn = aws_wafv2_ip_set.trusted_macs.arn
      }
    }
    visibility_config { ... }
  }
  ```
- **Requiere doble firma**: CISO + Tech Lead. Tracking en `docs/security/waf-managed-rules.md` § "IP allowlist".

## Recovery

### Camino A — Bloqueo real (ataque)

1. NO modificar el WAF (es la cobertura activa).
2. Si el ataque afecta perf: provisionar **IP block list explícito**:
   ```bash
   aws wafv2 create-ip-set \
     --name attacker-block-$(date +%s) \
     --scope REGIONAL \
     --addresses 198.51.100.5/32 \
     --ip-address-version IPV4
   ```
   Y agregar una rule `priority = 1` con action `block` apuntando a ese IP set.
3. Notificar a CISO + Roy. Abrir ticket forense si hay sospecha de exfiltración.

### Camino B — Bloqueo legítimo (tunable)

#### B.1 — Cambiar rule de BLOCK a COUNT (acción suave, no requiere PR)

Para mitigación INMEDIATA mientras se diagnostica:

```bash
# Ejemplo: poner AWSManagedRulesCommonRuleSet en COUNT temporalmente.
# REQUIERE doble firma CISO antes de ejecutar.
aws wafv2 update-web-acl \
  --name segurasist-prod-api-waf \
  --scope REGIONAL \
  --id <web-acl-id> \
  --lock-token <current-lock-token> \
  --default-action Allow={} \
  --visibility-config ... \
  --rules file://rules-with-override-count.json
```

> WARN: cambios manuales se sobrescriben en el próximo `terraform apply`. Abrir PR a `segurasist-infra` con el cambio definitivo en `< 24h`.

#### B.2 — Excluir una rule específica del rule group (recomendado)

En `segurasist-infra/envs/<env>/main.tf` agregar `rule_action_override` al `managed_rule_group_statement` (requiere extender el módulo si todavía no soporta excludes — hoy el módulo usa `for_each` simple sin overrides finos):

```hcl
# (extensión del módulo waf-web-acl pendiente)
managed_rule_group_statement {
  vendor_name = "AWS"
  name        = "AWSManagedRulesCommonRuleSet"
  rule_action_override {
    name = "SizeRestrictions_BODY"
    action_to_use { count {} }   # SizeRestrictions_BODY pasa de BLOCK a COUNT
  }
}
```

**Requiere doble firma CISO** (comentario en el PR + check en el log de excepciones).

#### B.3 — Subir el threshold del rate-limit

Si el block es por `rate-limit-per-ip` y el límite actual es genuinamente bajo para el caso de uso:

```hcl
module "waf_api" {
  # ...
  rate_limit_per_ip = 200  # antes 100
}
```

PR + apply. Sin requisito de firma CISO si el delta es <50% del valor actual.

### Caso especial — WAF caído / 5XX desde WAF

Si WAF retorna 5XX a TODO el tráfico:
- AWS WAF SLA es 99.95%. Una caída general dispara una alerta en AWS Health Dashboard.
- Verificar `aws wafv2 get-web-acl` — si la API responde, el WAF está OK; el problema es de la asociación o del backend.
- **NO desasociar el WAF** del App Runner / CloudFront sin doble firma CISO. Es preferible aceptar 5min de degradación que correr sin protección perimetral.
- Escalación: AWS Support case Severity: Production system down.

## Postmortem template

Completar para cada incidente WAF que:
- Bloqueó tráfico legítimo > 30 minutos, O
- Permitió tráfico claramente malicioso (false negative).

```
## Incidente WAF — <YYYY-MM-DD>

- **Web ACL**: segurasist-prod-{api|cf}-waf
- **Severity**: Pn
- **Timeline (UTC)**:
  - HH:MM — Detección (alarma / ticket)
  - HH:MM — Diagnóstico
  - HH:MM — Mitigación aplicada
  - HH:MM — Verificación con cliente afectado
- **Rule afectada**: <ruleId> / <ruleGroup>
- **Tipo**: false-positive / false-negative / config drift / AWS provider issue
- **Root cause**:
- **Fix**:
- **Customer impact**: cantidad MACs / operadores / tiempo de degradación
- **Action items (owner, due date)**:
  - [ ] PR a `segurasist-infra` con el fix definitivo
  - [ ] Test (terraform plan) que verifique el override
  - [ ] Update a `docs/security/waf-managed-rules.md` con la excepción + firma CISO
  - [ ] Si fue false negative: regla custom (Semgrep / WAF custom rule) que cubra el patrón
```

## Métricas de tracking

- Cantidad de blocks legítimos / mes (objetivo: ≤ 5 por env por mes).
- Tiempo medio entre detección y mitigación (objetivo: < 1 h).
- Rules en COUNT permanente (revisión trimestral con CISO).
- Cobertura de logs (% requests evaluadas con log entry — objetivo > 99%).

## Referencias

- `segurasist-infra/modules/waf-web-acl/README.md` — config del módulo.
- `segurasist-infra/docs/security/waf-managed-rules.md` — tabla de rules + falsos positivos comunes.
- AWS Docs: [WAFv2 Managed rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups.html).
- AWS Docs: [WAF logging](https://docs.aws.amazon.com/waf/latest/developerguide/logging.html).
