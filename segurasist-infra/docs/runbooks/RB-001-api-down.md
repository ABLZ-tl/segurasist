# RB-001 — API down (App Runner unhealthy)

- **Severity**: P1
- **On-call SLA**: acknowledge ≤ 15 min, resolve ≤ 4 h
- **Owner**: DevOps on-call
- **Triggered by**: CloudWatch alarm `segurasist-{env}-apprunner-5xx-rate`
- **Related**: RB-002 (RDS CPU), RB-007 (audit degraded), C-12 (Swagger DAST)

## Symptom

- Healthchecks externos rojo (UptimeRobot `status.segurasist.app` DOWN).
- App Runner service status `OPERATION_IN_PROGRESS` o `PAUSED`.
- 5xx rate sostenido > 5/min (>3/min en prod) en `AWS/AppRunner` →
  `5xxStatusResponse`.
- Frontend admin/portal muestran error 502/503 en cualquier llamada `/v1/*`.

## Detection

| Source | Metric / Indicator |
|---|---|
| CloudWatch alarm | `segurasist-{env}-apprunner-5xx-rate` |
| App Runner console | Service status ≠ `RUNNING` |
| Pino log stream (App Runner → CloudWatch Logs) | `[boot fatal]` o panics |
| ZAP/health endpoint | `GET /health/ready` 5xx |

## Triage (≤ 5 min)

1. Confirmar que NO es alerta cosmética: abrir CloudWatch dashboard
   `segurasist-{env}-overview` → ¿coincide caída con deploy reciente?
2. Si hay deploy en últimas 30 min → **rollback inmediato**:
   ```bash
   aws apprunner start-deployment \
     --service-arn $(terraform -chdir=envs/{env} output -raw apprunner_api_service_arn) \
     --image-identifier <last-known-good-tag>
   ```
3. Si NO hay deploy: ir a Mitigation.

## Mitigation

1. **Smoke test backend dependencies**:
   - RDS: `psql -h <endpoint> -U <user> -c 'SELECT 1'`. Si falla → RB-002.
   - Cognito: `aws cognito-idp describe-user-pool --user-pool-id <id>` 200.
   - SES: `aws ses get-account-sending-enabled` true. Si falsy → RB-004.
2. **App Runner restart manual** (forzar rolling):
   ```bash
   aws apprunner start-deployment --service-arn <arn>
   ```
3. **Scale out preventivo** (si CPU/mem maxed): ajustar `auto_scaling.max_size`
   en `envs/{env}/main.tf` y aplicar.
4. **Secrets rotation check**: si `DATABASE_URL` rotó hace <30 min, App Runner
   pudo no haber pickado el secret. Rebuild con nuevo deployment.
5. Si todo lo anterior falla → escalar a Backend Lead + invocar RB-003
   (failover cross-region).

## Root cause investigation (post-mitigación)

- Pull últimas 100 líneas de log:
  ```bash
  aws logs filter-log-events \
    --log-group-name /aws/apprunner/segurasist-{env}-api/<service-id>/application \
    --start-time $(($(date +%s) - 1800))000 \
    --filter-pattern '"ERROR" OR "FATAL" OR "uncaughtException"'
  ```
- Comparar con últimos 3 deploys en `aws apprunner list-operations`.
- Cross-check con WAF blocked spike (RB-005): un ataque DDoS puede tirar
  App Runner si el WAF rate-limit no fue suficiente.

## Postmortem checklist

- [ ] Timeline (UTC) — primer 5xx → ack on-call → mitigación → resolución.
- [ ] Root cause categoría: deploy / dependency / capacity / network / WAF FP.
- [ ] Detection gap (¿alarm latency > SLA?).
- [ ] Customer impact: # tenants afectados, # certificados/altas perdidas.
- [ ] Action items con owner + due date (≤ 2 semanas).
- [ ] ¿Necesita comunicación a Hospitales MAC? (≥30 min downtime → sí).
