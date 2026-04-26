# OPS-002 — PagerDuty Free + on-call rotation

**Estado:** ⬜ Pendiente
**Bloquea:** Alarmas P1/P2 con escalamiento (Sprint 5 + Go-Live)
**Owner:** DevOps Lead + PM
**Referencia:** `MVP_06_DevOps_IaC_SegurAsist.docx` §8.3

## Contexto

Las alarmas críticas (API down, breach, BD caída, GuardDuty Critical) deben paginar a una persona específica con SLA medible. CloudWatch alarms → SNS topic → Lambda → PagerDuty.

PagerDuty Free Tier permite 5 usuarios y 1 servicio — alcanza para el MVP.

## Pasos

### 1. Crear cuenta PagerDuty Free

- https://www.pagerduty.com/sign-up/
- Subdomain: `segurasist`
- 5 usuarios incluidos.

### 2. Crear servicio `segurasist-prod`

- Services → "New service"
- Nombre: `segurasist-prod`
- Integration type: **Events API v2** (genérico, lo dispara nuestra Lambda).
- Copiar **integration key** y guardarla en 1Password vault `External-Services`.

### 3. Crear schedule "On-call SegurAsist"

- People → Schedules → "New schedule"
- Cycle: **Weekly** (rotación semanal lunes 9 AM MX → lunes 9 AM MX).
- Layers:
  - **Layer 1 (Primary):** rotación entre DevOps Lead, Tech Lead, Backend Sr.
  - **Layer 2 (Backup):** Frontend Sr + QA Lead.
- Time zone: `America/Mexico_City`.

### 4. Escalation policy

- Step 1: Notify primary on-call (timeout 5 min).
- Step 2: Notify backup on-call (timeout 5 min).
- Step 3: Notify Tech Lead + DevOps Lead simultáneamente.
- Step 4: Notify CISO.

### 5. Notification channels por usuario

Cada miembro on-call debe configurar:
- SMS (mínimo).
- Push notification (app PagerDuty iOS/Android).
- Llamada de voz para P1 (opcional pero recomendado).

### 6. Lambda CloudWatch → PagerDuty

Esta Lambda la implemento yo en `segurasist-infra/modules/lambda-pagerduty-bridge/`:
- Trigger: SNS topics `seg-prod-alarms-p1`, `p2`, `p3`.
- Mapea CloudWatch alarm payload a PagerDuty Events API v2.
- Severity: `critical` (P1), `error` (P2), `warning` (P3).

### 7. Test inicial

Disparar manualmente desde CloudWatch:
```bash
aws cloudwatch set-alarm-state \
  --alarm-name segurasist-prod-api-down \
  --state-value ALARM \
  --state-reason "Test PagerDuty integration"
```

Esperar acuse del primary on-call en ≤5 min.

### 8. Hypercare config (Sprint 6 → +2 semanas post Go-Live)

Durante hypercare, **toda la rotación on-call está activa simultáneamente** (no rotación). Documentar en runbook RB-011.

## Evidencia esperada

- [ ] PagerDuty cuenta `segurasist` activa
- [ ] Servicio `segurasist-prod` creado con integration key en 1Password
- [ ] Schedule semanal con todos los miembros
- [ ] Test E2E: alarma → notificación → acuse en ≤5 min
- [ ] Runbook RB-011 hypercare publicado

## Cuándo migrar a PagerDuty Pro

- Cuando: equipo > 5 personas O necesidad de múltiples servicios O integraciones avanzadas (Jira, Slack auto-responder).
- Costo: $21/usuario/mes.
- Decisión en Sprint 5 según métricas hypercare.

## Alternativas evaluadas

| Tool | Free tier | Decisión |
|---|---|---|
| **PagerDuty** | 5 users, 1 service | ✅ Elegido — estándar industrial |
| Opsgenie (Atlassian) | 5 users | Considerar si ya usamos Jira |
| Better Stack (Better Uptime) | 3 monitors gratis | Bueno pero menos integraciones AWS |
