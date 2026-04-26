# OPS-004 — Slack workspace + canales

**Estado:** ⬜ Pendiente
**Bloquea:** Comunicación operativa diaria + alertas
**Owner:** PM
**Referencia:** `MVP_06_DevOps_IaC_SegurAsist.docx` §12 + `MVP_02_Plan_Proyecto_SegurAsist.docx` §7

## Contexto

Slack es la columna vertebral de la comunicación operativa: standups asíncronos, alertas automáticas, decisiones de día a día.

## Pasos

### 1. Workspace

- https://slack.com/get-started
- Workspace name: `SegurAsist`
- URL: `segurasist.slack.com`
- Plan: **Pro** ($7.25/usuario/mes) — historial ilimitado, 10 integraciones gratis no aplica más.

### 2. Canales requeridos

| Canal | Propósito | Miembros default | Tipo |
|---|---|---|---|
| `#general` | Anuncios | Todos | Público |
| `#segurasist-mac` | Operación día a día del cliente MAC | Equipo + PM + PO | Privado |
| `#segurasist-eng` | Ingeniería: discusiones técnicas, PRs | Devs | Privado |
| `#segurasist-cost` | Alertas costos AWS Budgets | DevOps + PM | Privado |
| `#segurasist-alerts` | Alertas operativas (CloudWatch, UptimeRobot, GuardDuty) | DevOps + Tech Lead | Privado |
| `#segurasist-irp` | Incident Response Plan war-room (lazy-create) | CISO + on-call activo | Privado |
| `#segurasist-deploys` | Deploy notifications (GitHub Actions) | Devs | Público interno |
| `#random` | Off-topic | Todos | Público |

### 3. Integraciones críticas

| Integración | Canal destino | Configuración |
|---|---|---|
| GitHub | `#segurasist-deploys` | PR/merge events de los 3 repos |
| AWS Chatbot | `#segurasist-alerts` | SNS topics de alarmas |
| UptimeRobot | `#segurasist-alerts` | Webhook outbound |
| AWS Budgets | `#segurasist-cost` | SNS topic budgets |
| Linear | `#segurasist-eng` | Issue updates |
| PagerDuty | `#segurasist-alerts` | Incident events |

### 4. Política de notificaciones

- `@channel` permitido **solo** para alertas P1 o anuncios programados.
- Canales `#*-alerts` y `#*-cost` con notificaciones agresivas (mobile push).
- `#segurasist-eng` y `#segurasist-mac`: notificaciones normales.
- DM solo para discusiones 1:1; decisiones técnicas en canal público.

### 5. Reglas de comunicación

- **Norma 1**: cualquier decisión técnica importante se documenta en ADR (no se queda en Slack).
- **Norma 2**: stand-up async diario en thread fijo de `#segurasist-eng` (qué hice ayer, qué hago hoy, bloqueos).
- **Norma 3**: nada de credenciales, secretos, ni datos personales en Slack — siempre 1Password o canales seguros.
- **Norma 4**: Slack no es para crisis prolongadas — si supera 30 min, abrir war-room en Zoom/Teams.

### 6. Workflows automatizados (Slack Workflow Builder, gratis)

- **Onboarding**: cuando alguien se une a `#segurasist-eng`, mensaje automático con links a docs y CODEOWNERS.
- **PR checklist**: Workflow que se dispara en PR open con checklist de DoD.
- **Deploy aproval**: notificación con botón al canal `#segurasist-mac` cuando un deploy a prod necesita approval.

## Evidencia esperada

- [ ] Workspace `segurasist.slack.com` activo
- [ ] 8 canales creados con membresía correcta
- [ ] Integraciones GitHub + AWS Chatbot + UptimeRobot funcionando
- [ ] Política de notificaciones publicada en `#general` (pinned)
- [ ] Mensaje de bienvenida con docs links

## Costo

- 5 personas × $7.25 = **~$36 USD/mes**
- Año 1 con equipo escalado a 8 = **~$696 USD/año**

## Alternativa

Microsoft Teams si MAC ya está en Microsoft 365 y prefieren un solo workspace con ellos. Decisión: **separar workspaces** (interno SegurAsist + canal compartido con MAC vía Teams shared channels).
