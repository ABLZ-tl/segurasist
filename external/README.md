# external/ — Tareas que requieren acción del usuario

Estos documentos describen acciones que **no puedo automatizar** desde código local: requieren que tú (o personal con acceso) ejecute comandos en consolas externas (AWS, GitHub, dominios, IdP del cliente, contratos legales).

## Cómo trabajar este folder

1. Cada `MD` describe **una tarea atómica**: contexto, pasos, evidencia esperada.
2. Cuando termines una tarea, **avísame** para marcarla resuelta y desbloquear lo que dependa de ella.
3. Las tareas están priorizadas por bloqueo: `AWS-001` y `GH-001` son los más urgentes para arrancar Sprint 0.

## Índice

| ID | Título | Bloquea | Estado |
|---|---|---|---|
| [AWS-001](AWS-001-cuentas-aws-organizations.md) | Cuentas AWS + Organizations + IAM Identity Center | Toda la infra | ⬜ |
| [AWS-002](AWS-002-ses-sandbox.md) | SES — salida de sandbox + dominio verificado | F3 Certificados (envío real) | ⬜ |
| [AWS-003](AWS-003-dominio-route53-acm.md) | Dominio `segurasist.app` + Route 53 + ACM (regional + us-east-1) | Frontend + API públicos | ⬜ |
| [AWS-004](AWS-004-region-mx-central-availability.md) | **Verificar disponibilidad de servicios en mx-central-1** | **Sprint 1 (Terraform apply)** | ⬜ |
| [GH-001](GH-001-github-org-repos.md) | GitHub Org + 3 repos + Branch Protection + Advanced Security | CI/CD | ⬜ |
| [GH-002](GH-002-github-oidc-aws.md) | GitHub Actions OIDC con AWS (sin claves) | Deploys | ⬜ |
| [MAC-001](MAC-001-saml-azure-ad.md) | Federación SAML con Azure AD MAC | Sprint 5 SSO real | ⬜ |
| [MAC-002](MAC-002-layout-asegurados.md) | Validación del layout oficial con Lucía | Sprint 1 carga masiva | ⬜ |
| [LEG-001](LEG-001-dpa-aviso-privacidad.md) | DPA AWS firmado + Aviso de Privacidad | LFPDPPP | ⬜ |
| [OPS-001](OPS-001-1password-vault.md) | 1Password Business + vault Equipo | Onboarding | ⬜ |
| [OPS-002](OPS-002-pagerduty.md) | PagerDuty Free + on-call rotation | Alertas P1/P2 | ⬜ |
| [OPS-003](OPS-003-uptimerobot.md) | UptimeRobot Pro + status page | SLA externo | ⬜ |
| [OPS-004](OPS-004-slack-workspace.md) | Slack workspace + canales | Comunicación | ⬜ |
