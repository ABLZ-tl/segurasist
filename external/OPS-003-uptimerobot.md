# OPS-003 — UptimeRobot Pro + status page

**Estado:** ⬜ Pendiente
**Bloquea:** SLA tracking externo + status page público
**Owner:** DevOps
**Referencia:** `MVP_06_DevOps_IaC_SegurAsist.docx` §1.1, §8.1

## Contexto

Necesitamos monitoreo externo independiente de AWS para tracking de SLA contractual (99.5% mensual) y para que MAC pueda verificar el estado del servicio en una página pública.

## Pasos

### 1. Plan UptimeRobot Pro

- https://uptimerobot.com/pricing/
- Plan: **Pro** ($7/mes) — 50 monitores, intervalo 1 min, status page custom domain.
- Cuenta: con email `aws-monitoring@segurasist.app`.

### 2. Monitores a crear

| Monitor | URL/Target | Tipo | Interval |
|---|---|---|---|
| API root | `https://api.segurasist.app/health/ready` | HTTPS keyword "ok" | 1 min |
| Admin home | `https://admin.segurasist.app` | HTTPS 200 | 1 min |
| Portal home | `https://portal.segurasist.app` | HTTPS 200 | 1 min |
| Login admin | `https://auth.segurasist.app` | HTTPS 200 | 5 min |
| OpenAPI | `https://api.segurasist.app/v1/openapi.json` | HTTPS 200 | 5 min |
| Files CDN | `https://files.segurasist.app/healthz.txt` | HTTPS 200 | 5 min |
| TLS expiry | `segurasist.app` | SSL/TLS | 24h, alerta a 30 días |

### 3. Status page público

- UptimeRobot → Status pages → "Add new"
- Custom domain: `status.segurasist.app` (CNAME a UptimeRobot)
- Branding: logo SegurAsist + colores
- Componentes visibles:
  - **API** (api.segurasist.app)
  - **Portal Admin** (admin.segurasist.app)
  - **Portal Asegurado** (portal.segurasist.app)
  - **Descargas** (files.segurasist.app)
- Mostrar uptime últimos 90 días.
- Suscripciones email permitidas.

### 4. Alertas de UptimeRobot

Cuando un monitor cae:
- Email a `oncall@segurasist.app` (lista distribución).
- Webhook a Slack `#segurasist-alerts`.
- (Opcional) PagerDuty integration si el SLA externo lo justifica.

### 5. Reporte mensual SLA

Configurar reporte mensual auto-enviado a:
- Roy (sponsor)
- Alejandro (MAC)
- PM SegurAsist

Contenido: % uptime, incidentes, MTTR.

## Evidencia esperada

- [ ] Cuenta Pro activa
- [ ] 7 monitores creados con interval correcto
- [ ] Status page público accesible en `status.segurasist.app`
- [ ] Reporte mensual programado
- [ ] Alerta de prueba recibida (apagar staging deliberadamente 2 min)

## Costo

- $7 USD/mes = ~$84 USD/año.
