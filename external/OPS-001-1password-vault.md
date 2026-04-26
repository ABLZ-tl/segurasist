# OPS-001 — 1Password Business + vault Equipo

**Estado:** ⬜ Pendiente
**Bloquea:** Onboarding de cualquier dev nuevo (acceso a credenciales)
**Owner:** PM + Tech Lead
**Referencia:** `MVP_06_DevOps_IaC_SegurAsist.docx` §7, §12

## Contexto

Necesitamos un gestor de secretos para credenciales humanas (no para CI/CD — eso usa AWS Secrets Manager + OIDC). 1Password Business es el estándar de la industria para equipos pequeños.

## Pasos

### 1. Plan 1Password Business

- Plan: **Business** ($7.99/usuario/mes, primer mes gratis).
- Cuenta: `segurasist` (https://segurasist.1password.com).
- SSO opcional con Google Workspace (no requerido al inicio).

### 2. Vaults a crear

| Vault | Acceso | Contenido |
|---|---|---|
| `Equipo` | Todos los devs | Credenciales compartidas no-críticas (Storybook, dev tools) |
| `Compliance` | CISO + Tech Lead + PM | DPAs firmados, certificaciones, acuerdos legales |
| `AWS-Prod-BreakGlass` | DevOps Lead + Tech Lead (con MFA hard) | Root user creds + recovery codes |
| `External-Services` | DevOps + leads | UptimeRobot, PagerDuty, GitHub Org admin |
| `Personal` | Por usuario | Sus propias credenciales |

### 3. Política de uso

- **Prohibido pegar secretos en Slack, email, código.**
- Compartir solo via "Share" de 1Password (link con expiración 7d).
- **MFA obligatoria** en cada cuenta (TOTP mínimo, WebAuthn preferido).
- Auditoría: revisar logs de acceso al vault `AWS-Prod-BreakGlass` semanalmente.

### 4. Onboarding de dev nuevo

Día 1 del onboarding:
1. PM crea cuenta 1Password con email corporativo del dev.
2. Asigna a vault `Equipo`.
3. Dev debe activar TOTP en primera sesión.
4. Si necesita acceso a `External-Services`, request explícita al Tech Lead.

## Evidencia esperada

- [ ] Cuenta 1Password Business activa
- [ ] 5 vaults creados con permisos correctos
- [ ] Todos los miembros del equipo invitados con MFA activa

## Costo

- 5 personas × $7.99 = **~$40 USD/mes**
- Año 1 con equipo de 8 (incluye 2 freelancers) = **~$770 USD/año**
