# RB-005 — WAF blocked requests spike

- **Severity**: P2 (P1 si afecta legitimate traffic / customer comms)
- **On-call SLA**: acknowledge ≤ 15 min, decisión ≤ 1 h
- **Owner**: DevOps on-call + Security Lead
- **Triggered by**: CloudWatch alarms:
  - `segurasist-{env}-waf-blocked-spike` (REGIONAL, API)
  - `segurasist-{env}-waf-cf-blocked-spike` (CLOUDFRONT, prod only)
- **Related**: RB-001 (API down by overload), RB-016 (WAF rules detail)

## Symptom

- Spike sostenido en `AWS/WAFV2 BlockedRequests` (>100/5min dev,
  >200 staging, >500 prod REGIONAL, >1000 prod CLOUDFRONT).
- Soporte cliente reporta "no puedo loguearme" / "página en blanco" /
  CAPTCHAs apareciendo.
- Firewall Manager dashboard muestra source IPs concentradas o
  rule signatures nuevas.

## Detection

| Source | Metric |
|---|---|
| CloudWatch | `AWS/WAFV2 BlockedRequests` Sum > threshold/5min |
| WAF logs (CW Log Group `aws-waf-logs-segurasist-*`) | `action=BLOCK` |
| App Runner 4xx rate (correlated) | rising 403 desde IP rangos sospechosos |

## Triage (≤ 5 min)

1. Abrir WAF Web ACL → **Sampled requests** (last 3 hours).
2. Filter por `action = BLOCK` → ordenar por `Source IP` y
   `Rule matched`.
3. Pregunta crítica: **¿attack o false positive?**
   - Si > 80% de blocks vienen de **una geo extranjera única**
     (CN/RU/IR) y nunca tuvimos clientes ahí → **attack**, ir a paso
     "Mitigation - Attack confirmed".
   - Si IPs son **distribuidas** (residencial + cloud + corporate) Y
     User-Agent es real (Chrome/Firefox normal) → posible **false
     positive** de regla nueva, ir a paso "Mitigation - FP".
   - Si pico coincide con **deploy reciente** del frontend (más
     requests por page load) → bump rate-limit.

## Mitigation — Attack confirmed

1. **Block source temporarily** (15 min) via WAF rule add:
   - Console: Web ACL → Add rule → IP set match → `effect = BLOCK`.
   - Geo block (si attack 100% una región):
     ```hcl
     # En modules/waf-web-acl/main.tf, agregar geo_match_statement
     ```
2. Activar **rate-based rule más agresiva** (en prod baseline = 100/min,
   bajar a 50/min temporalmente).
3. Verificar **App Runner CPU + RDS connections** durante el pico:
   si subieron a >70% baseline → escalar (RB-001 / RB-002).
4. Notificar a CloudFront (si CF scope) de elevar shielding temporalmente.

## Mitigation — False positive (legit traffic blocked)

1. Identificar **Rule matched** del block sample.
2. Si es regla **AWS Managed Rule Group** (Common, Bots) → agregar
   exception por URI en Web ACL:
   - Console: Rule action override → `Count` para esa rule.
3. Si es **rate-based**: revisar baseline último 30 d. Si traffic
   creció orgánicamente, bumpear `rate_limit_per_5min` en
   `envs/{env}/main.tf` (`waf_api` module) y aplicar.
4. Confirmar con cliente que el block paró.

## Root cause investigation

- Pull WAF logs en CW Logs Insights:
  ```
  fields @timestamp, action, terminatingRuleId, httpRequest.uri,
         httpRequest.country, httpRequest.clientIp
  | filter action = "BLOCK"
  | stats count() by terminatingRuleId, httpRequest.country
  | sort count desc
  ```
- Cross-check con `RB-005-cross-tenant-attempt.md` (legacy) — si rule
  matched es signature de SQLi/XSS en path `/v1/insureds?...` y origin
  es **insured** → puede ser intento cross-tenant cubierto por C-11
  cookie hardening, escalar a Security Lead.
- Si attack persiste post-mitigación → considerar **Shield Advanced**
  enrollment + page CISO.

## Postmortem checklist

- [ ] Categoría: attack vs FP vs traffic growth.
- [ ] Si attack: vector (DDoS, scraping, credential stuffing, exploit).
- [ ] Customer impact: legitimate users bloqueados? Tickets soporte?
- [ ] Action items: ajuste rule? Nueva managed rule? Shield Advanced?
- [ ] Update RB-016 (WAF rules) si emergió un patrón sistémico.
