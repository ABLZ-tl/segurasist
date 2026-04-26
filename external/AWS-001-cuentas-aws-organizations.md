# AWS-001 — Cuentas AWS + Organizations + IAM Identity Center

**Estado:** ⬜ Pendiente
**Bloquea:** toda la infraestructura (Terraform no puede aplicar sin esto)
**Owner:** DevOps / sponsor
**Referencia:** `MVP_06_DevOps_IaC_SegurAsist.docx` §2

## Contexto

Necesitamos 6 cuentas AWS organizadas en OUs separadas para aislar blast-radius y auditoría:

| Cuenta | Email recomendado | OU | Propósito | Pass |
|---|---|---|---|---|
| root | aws-root@segurasist.app | — | Billing, Organizations, IAM IC, SCPs | |
| security | aws-security@segurasist.app | Security | GuardDuty/Security Hub agg | |
| log-archive | aws-logs@segurasist.app | Security | CloudTrail org-wide a S3 Object Lock | |
| dev | aws-dev@segurasist.app | Workloads | Sandbox devs | |
| staging | aws-staging@segurasist.app | Workloads | Réplica de prod | |
| prod | aws-prod@segurasist.app | Workloads | Producción real | |

## Pasos

### 1. Crear cuenta raíz (root)
- Registra cuenta nueva en https://aws.amazon.com con email `aws-root@segurasist.app` (alias o lista de distribución).
- Habilita **MFA hardware (Yubikey)** en el root user inmediatamente.
- Crea tarjeta corporativa exclusiva para AWS (revisión mensual con PM).

### 2. Activar AWS Organizations
- Consola → AWS Organizations → "Create organization" (modo "All features", no "Consolidated billing only").
- Crear OUs: `Security`, `Workloads`.

### 3. Crear las 5 cuentas miembro
- Organizations → "Add account" → repetir 5 veces con los emails de la tabla.
- Asignar cada cuenta a su OU.

### 4. Activar IAM Identity Center (SSO)
- Consola → IAM Identity Center → "Enable".
- Región: `mx-central-1`.
- Federar con **Google Workspace** (o el IdP corporativo SegurAsist) vía SAML.
- Crear permission sets:
  - `AdminFullAccess` (MFA hard obligatoria — solo Tech Lead + DevOps Lead break-glass)
  - `DevOpsEngineer`
  - `ReadOnly`
  - `BillingViewer`
  - `SecurityAuditor`

### 5. Aplicar SCPs base (root)
Adjuntar a la org root (heredan todas las cuentas):
- Bloquear regiones fuera de `mx-central-1, us-east-1` (excepto IAM y CloudFront que son globales)
- Bloquear deshabilitación de GuardDuty / Security Hub / Config / CloudTrail
- Bloquear creación de IAM users (forzar IAM IC)
- Bloquear creación de S3 buckets sin cifrado y sin Block Public Access
- Bloquear borrado de objetos en buckets con Object Lock COMPLIANCE

> Las definiciones JSON de las SCPs van versionadas en `segurasist-infra/global/organization/scps/`.

### 6. Activar GuardDuty + Security Hub + Config (org-wide)
Desde la cuenta `security`:
- GuardDuty: "Designate organization administrator" → cuenta `security`.
- Security Hub: misma operación.
- AWS Config: misma operación.
- Habilitar CIS AWS Foundations Benchmark v2.0 en Security Hub.

### 7. Activar CloudTrail org-wide
- Trail con destino al bucket en cuenta `log-archive` con **S3 Object Lock COMPLIANCE 730 días**.
- Cifrado SSE-KMS con CMK dedicada en `log-archive`.

## Evidencia esperada

- [ ] Captura de pantalla de Organizations con 6 cuentas listadas
- [ ] Account IDs de cada cuenta (compartir conmigo en Slack/1Password — no en este MD)
- [ ] Permission sets visibles en IAM Identity Center
- [ ] GuardDuty findings reciben en cuenta `security`
- [ ] CloudTrail trail org-wide habilitado y entregando

## Costo estimado mensual

| Item | Costo USD/mes |
|---|---|
| GuardDuty (3 cuentas activas) | ~5–15 |
| Security Hub | ~3 |
| AWS Config | ~5 |
| CloudTrail (1 trail org-wide gratis) | 0 |
| **Total mes 1** | **~13–23** |

## Notas

- Los **Account IDs** son sensibles a nivel operativo. **No los pegues aquí**; compártelos solo en 1Password vault `Compliance` o por canal cifrado.
- Si decides usar **AWS Control Tower** (más completo, opinionated), las SCPs e IAM IC vienen pre-configurados. Costo: ~$5/cuenta/mes adicional. Recomendado si el equipo no tiene experiencia previa con Organizations.
