# RB-020 — GuardDuty Findings Triage

> **Severity**: P1 si severity ≥ 7.0 + producción + recurso crítico (RDS, audit bucket, secrets KMS); P2 si severity ≥ 7.0 en dev/staging o ≥ 4.0 en cualquier env; P3/info si < 4.0.
> **On-call SLA**: ack ≤ 15 min (P1), ≤ 1h (P2), ≤ 24h (P3).
> **Owner**: DevOps Security on-call + CISO (si severity ≥ 7.0 en prod).
> **Related**: RB-006 (GuardDuty Critical — superseded by this runbook), RB-009 (KMS rotation), RB-010 (IRP triage P1), ADR-0010 (GuardDuty findings triage).
> **Created**: Sprint 5 S5-2. Updated S5-2 iter 2 (CC-25 + lambdas reales).

---

## Pre-deploy: Slack webhook setup (one-time per env)

> **CC-25 (S5-2 iter 2)**: el Lambda `${env}-security-slack-forwarder` lee la URL del webhook desde SecretsManager. El secret se crea **fuera** de Terraform porque la URL contiene credenciales sensibles que NO deben pasar por tfvars/state. Sólo el ARN del secret entra a Terraform via `slack_security_webhook_secret_arn`.
>
> **Owner del bootstrap**: DevOps lead (one-time por env). **Rotación**: trimestral, manual.

### Paso 1 — crear webhook en Slack

1. En Slack, abrir <https://api.slack.com/apps> → "Create New App" → "From scratch".
2. Nombre: `SegurAsist Security Alerts (${env})`. Workspace: `segurasist`.
3. Sidebar → "Incoming Webhooks" → toggle ON → "Add New Webhook to Workspace".
4. Seleccionar canal:
   - dev → `#security-alerts-dev`
   - staging → `#security-alerts-staging`
   - prod → `#security-alerts-prod`
5. Click "Allow". Copiar la URL `https://hooks.slack.com/services/T0XXXX/B0XXXX/...`.

### Paso 2 — seedear el secret en SecretsManager

```bash
ENV=dev   # o staging / prod
WEBHOOK_URL='https://hooks.slack.com/services/T0XXXX/B0XXXX/XXXXXXXXXXXXX'

aws secretsmanager create-secret \
  --region mx-central-1 \
  --name "segurasist/security/slack-webhook-${ENV}" \
  --description "Slack webhook for SegurAsist security alerts (${ENV}). Owner: DevOps. Rotation: quarterly manual." \
  --secret-string "$WEBHOOK_URL" \
  --tags Key=Environment,Value=${ENV} Key=Component,Value=security-alarms Key=Owner,Value=devops-security

# Capturar el ARN para Terraform.
SECRET_ARN=$(aws secretsmanager describe-secret \
  --region mx-central-1 \
  --secret-id "segurasist/security/slack-webhook-${ENV}" \
  --query ARN --output text)
echo "$SECRET_ARN"
```

> El forwarder también acepta payloads JSON `{"url":"https://hooks.slack.com/..."}` — útil si quieres rotar sin recrear (SecretsManager versioning maneja `AWSCURRENT` vs `AWSPENDING`).

### Paso 3 — pasar el ARN a Terraform

Editar `segurasist-infra/envs/${ENV}/terraform.tfvars` (gitignored):

```hcl
slack_security_webhook_secret_arn = "arn:aws:secretsmanager:mx-central-1:<account>:secret:segurasist/security/slack-webhook-dev-XXXXXX"
```

O exportar como TF_VAR si CI lo prefiere:

```bash
export TF_VAR_slack_security_webhook_secret_arn="$SECRET_ARN"
```

### Paso 4 — build de las Lambdas (pre-apply)

> El módulo `security-alarms` zipea `lambdas/slack-forwarder/` y `lambdas/quarantine/` directamente. `node_modules` debe estar presente antes de `terraform apply` (gitignored — se vendora local o en CI).

```bash
cd segurasist-infra/modules/security-alarms/lambdas
./build.sh
# wrote dist/slack-forwarder.zip + dist/quarantine.zip; node_modules quedó cacheado en cada lambda dir
```

### Paso 5 — apply

```bash
cd segurasist-infra/envs/${ENV}
terraform init
terraform apply
```

> NOTA: el `time_sleep.wait_for_standards` (60s) en `module.security_hub` absorbe el race window de propagación de controles de Security Hub (anteriormente requería un segundo apply en cold-start — CC-18 iter 2 lo resuelve para warm subscriptions).

### Rotación (trimestral)

1. Generar nuevo webhook en Slack (reemplaza el viejo automáticamente al revocar el anterior).
2. `aws secretsmanager put-secret-value --secret-id "segurasist/security/slack-webhook-${ENV}" --secret-string "$NEW_URL"`.
3. El forwarder Lambda recoge el nuevo valor en el siguiente cold-start. Para forzar:
   ```bash
   aws lambda update-function-configuration --function-name "${ENV}-security-slack-forwarder" --description "rotated $(date -u +%Y-%m-%d)"
   ```
4. Validar con `aws guardduty create-sample-findings --detector-id <id>` y verificar el post en Slack.

---

## Symptom

Una o varias señales:

1. **EventBridge** dispara la rule `${env}-guardduty-high-critical` (severity ≥ 7.0) → SNS topic `${env}-security-alerts` → Slack canal `#security-alerts-${env}`.
2. **CloudWatch alarm** `${env}-securityhub-failed-compliance` en estado ALARM (> 5 fallos compliance en 1h).
3. **Email/page** desde la rotación on-call P1.
4. **Hallazgo manual** en consola: `https://console.aws.amazon.com/guardduty/home?region=mx-central-1#/findings`.

---

## Severity scale (referencia AWS)

| Rango severity | Clasificación | Acción |
|---|---|---|
| 0.1 – 3.9 | LOW | Log + revisar en weekly review. NO ticket automático. |
| 4.0 – 6.9 | MEDIUM | Ticket Jira/Linear (auto-creado por workflow `security-findings-triage`). |
| 7.0 – 8.9 | HIGH | Page on-call. SNS publish. ≤ 15 min ack. |
| 9.0 – 10.0 | CRITICAL | Page on-call + CISO. Probable IRP P1 (escalar a RB-010). |

> NOTA: la "scale" 9.0-10.0 está reservada por AWS para hallazgos malware confirmados (EBS scan match) y CnC con alta confianza. Severity > 8.9 numéricamente es raro pero válido.

---

## False positives comunes

Antes de escalar, descartar:

1. **Recon:EC2/Portscan** desde IPs internas: scanners autorizados (Inspector v2, AWS Config) generan false positives. Verificar que la fuente sea un servicio AWS.
2. **UnauthorizedAccess:IAMUser/ConsoleLoginSuccess.B**: login admin desde una IP nueva pero validada (engineer en viaje). Confirmar via OOB con el engineer antes de bloquear.
3. **Backdoor:EC2/DenialOfService.Tcp**: tráfico legítimo de health checks o load test. Cross-check con `tests/performance/k6/` schedule.
4. **CryptoCurrency:EC2/BitcoinTool.B!DNS**: DNS resolution a pool minero — investigar si es resultado de un test container que se filtró.
5. **Discovery:S3/MaliciousIPCaller.Custom**: IP en threat-intel list pero accediendo a un bucket público intencional (CDN/portal assets).

---

## Triage (≤ 15 min)

### Paso 1 — recolectar finding completo

```bash
ENV=prod   # o staging/dev
FINDING_ID=<extracto del Slack/email>

aws guardduty get-findings \
  --region mx-central-1 \
  --detector-id "$(aws guardduty list-detectors --region mx-central-1 --query 'DetectorIds[0]' --output text)" \
  --finding-ids "$FINDING_ID" \
  --output json > /tmp/finding-$FINDING_ID.json

jq '.Findings[0] | {Type, Severity, Resource: .Resource.ResourceType, Account: .AccountId, Region, CreatedAt, UpdatedAt, Title, Description}' /tmp/finding-$FINDING_ID.json
```

### Paso 2 — clasificar por categoría

GuardDuty type tiene formato `<ThreatPurpose>:<ResourceType>/<ThreatFamily>!<DetectionMechanism>`:

- **Backdoor**: shell/CnC instalado.
- **CryptoCurrency**: minería detectada.
- **Discovery**: enumeración (port scans, IAM listing).
- **Exfiltration**: data egress sospechoso (S3, DNS).
- **Impact**: tampering/destrucción detectada.
- **InitialAccess**: brute force, credential stuffing.
- **PenTest**: actividad reconocible de Kali/Metasploit.
- **Persistence**: persistence techniques (cron drops, IAM key creation post-compromise).
- **Policy**: violación de policy (root login, unauthorized region).
- **PrivilegeEscalation**: IAM privilege escalation.
- **Recon**: reconnaissance (port scan, IAM enum).
- **ResourceConsumption**: abuse de recursos.
- **Stealth**: log tampering / detection evasion.
- **Trojan**: trojan activity.
- **UnauthorizedAccess**: acceso unauthorized validado.

### Paso 3 — decidir acción (matriz por categoría)

| Categoría | Acción inmediata | Owner | Plazo |
|---|---|---|---|
| **Backdoor:EC2/...** | Aislar instancia (auto-quarantine Lambda en staging/prod). Snapshot EBS para forensics. Rotar IAM keys del rol asociado. Escalar IRP. | DevOps Security + CISO | ≤ 30 min |
| **CryptoCurrency** | Aislar workload, revisar imagen Docker reciente (supply-chain), revocar credentials, snapshot. Revisar si hubo `docker pull` desde registry no whitelisted. | DevOps Security | ≤ 1 h |
| **Reconnaissance** | Si origen externo: WAF rate-limit + IP set block. Si interno: confirmar si es scanner autorizado, sino tratar como Backdoor. | DevOps + WAF owner | ≤ 2 h |
| **Trojan** | Igual que Backdoor: aislar + snapshot + IRP. Recuperar via AMI golden + restore data PITR. | DevOps Security | ≤ 30 min |
| **UnauthorizedAccess:IAMUser/ConsoleLoginSuccess.B** | Verificar OOB con dueño del usuario; si no autorizado: revocar sesión, deshabilitar usuario, rotar MFA, audit CloudTrail por blast radius. | DevOps + IAM owner | ≤ 30 min |
| **UnauthorizedAccess:S3/MaliciousIPCaller** | Bloquear IP en bucket policy + WAF. Revisar audit_log para qué objects se accedieron. Si data sensitive expuesta → notificación legal. | DevOps + Security | ≤ 1 h |
| **Exfiltration:S3/...** | Bloquear IP/role. Audit CloudTrail S3 data events. Cuantificar volumen exfiltrado (GB) y clasificar (PII? facturas?). Activar IRP P1. | DevOps + CISO + Legal | ≤ 30 min |
| **PrivilegeEscalation** | Revocar policy attachment recién agregado, audit `iam:AttachRolePolicy` events. Notificar arquitectura. | DevOps + IAM owner | ≤ 1 h |
| **Stealth:CloudTrailLoggingDisabled** | RE-ENABLE CloudTrail inmediatamente (SCP `deny-disable-guardduty-sh` ya bloquea esto en org level — si firea es CRITICAL bypass). | DevOps + CISO | ≤ 15 min |
| **Discovery (LOW/MEDIUM)** | Si severity < 4.0: log only. Si ≥ 4.0: evaluar pattern (sostenido vs spike). | DevOps Security | ≤ 24 h |

---

## Auto-respuesta (Backdoor:EC2/*)

El módulo `security-alarms` provisiona un Lambda (`${env}-security-quarantine`) que se ejecuta automáticamente al detectar `Backdoor:EC2/...`. La Lambda:

1. Llama `ec2:ModifyInstanceAttribute` para reemplazar el SG por `var.quarantine_security_group_id` (no inbound, egress mínimo a snapshot service).
2. Tagea la instancia: `Quarantined=true`, `QuarantinedAt=<ISO>`, `FindingId=<id>`.
3. Emite EMF metric `SegurAsist/Security/InstancesQuarantined` para alarmas downstream.
4. Publica en SNS `${env}-security-alerts` con título `[AUTO-QUARANTINED] <instance-id>`.

> **Habilitación**: dev=off, staging=on (canary), prod=on tras review S5-2 iter 2.
> **Rollback**: revertir SG manualmente → `aws ec2 modify-instance-attribute --instance-id <id> --groups <original-sg>`.

---

## Cuándo escalar a CISO

Escalación P1 obligatoria si:

- severity ≥ 7.0 **AND**
- env = prod **AND**
- recurso afectado ∈ { RDS prod, audit S3 bucket, secrets KMS key, Cognito user pools, IAM role asociado a App Runner }.

O cualquiera de:

- exfiltration confirmada de datos PII / facturas (CFDI con RFC personas físicas).
- compromise de master account (org root, billing).
- 3+ findings HIGH/CRITICAL en ventana de 1h (probable ataque coordinado).

Canal: PagerDuty rotation `security-on-call` + Slack DM al CISO + email `ciso@segurasist.app`.

---

## Containment / Recovery

### Reglas duras

1. **NUNCA** terminar (`ec2:TerminateInstance`) la instancia comprometida sin snapshot previo. Forensics requiere el disco intacto.
2. **NUNCA** rotar la KMS key sin coordinación — si la instancia comprometida tenía data cifrada in-flight, la rotación rompe el descifrado de logs in-transit (RB-009).
3. **SIEMPRE** preservar audit trail: tomar snapshot de `audit_log` table al momento del finding (timestamp del IRP).

### Pasos generales

1. **Aislar**: SG quarantine, revocar IAM session (`aws iam delete-login-profile` + `iam:DeleteAccessKey`).
2. **Snapshot**: EBS + RDS PITR snapshot.
3. **Investigate**: CloudTrail Lake query `eventName=Console* OR eventSource IN (s3,ec2,iam)` en ventana ±2h del finding.
4. **Remediate**: rotar credentials, parchar imagen, redeploy desde golden AMI.
5. **Validate**: re-run GuardDuty malware scan (`StartMalwareScan`).
6. **Document**: post-mortem (template abajo).

---

## Plantilla post-mortem

Archivo: `docs/security/postmortems/PM-<YYYY-MM-DD>-<short-name>.md`

```markdown
# PM-<date>-<name>

## Finding
- ID: <finding-id>
- Type: <Backdoor:EC2/...>
- Severity: <X.Y>
- Resource: <arn>
- Detected at: <ISO>
- Containment at: <ISO>
- Resolved at: <ISO>

## Timeline (UTC)
- T+0   : Finding fires (GuardDuty).
- T+Xm  : Slack notified, on-call ack.
- T+Ym  : Containment (SG quarantine).
- T+Zm  : Forensics snapshot taken.
- T+Wh  : Root cause identified.
- T+Vh  : Remediation deployed.
- T+Uh  : Validation complete (rescan clean).

## Impact
- Resources affected:
- Data exposure (Y/N + scope):
- Customer impact (Y/N):
- Compliance impact (PCI/CFDI/data-privacy):

## Root cause (5-Whys)
1. Why ...?
2. Why ...?
3. Why ...?
4. Why ...?
5. Why ...?

## Action items
- [ ] Detection improvement: <e.g. add EventBridge rule for X>
- [ ] Prevent recurrence: <e.g. patch base AMI, update SCP>
- [ ] Process: <e.g. add quarterly access review>

## References
- Finding JSON: s3://${env}-segurasist-security-findings/.../<finding-id>.json
- CloudTrail Lake query: <link>
- ADR-0010 (auto-suppression list).
```

---

## Dev local / LocalStack

> **GuardDuty NO está soportado en LocalStack free tier**. Los tests de integración del módulo se saltan en CI cuando `LOCALSTACK_ENDPOINT` está set. Validar contra una cuenta AWS real (sandbox) o sandbox compartido del equipo. La feature `aws_guardduty_detector_feature` requiere endpoint regional real.

Pasos validación local:

```bash
# Validate sintaxis (offline)
terraform -chdir=segurasist-infra/envs/dev validate

# Plan contra cuenta AWS sandbox (requiere AWS_PROFILE)
terraform -chdir=segurasist-infra/envs/dev plan \
  -target=module.guardduty \
  -target=module.security_hub \
  -target=module.security_alarms
```

---

## Referencias

- `segurasist-infra/modules/guardduty/` — módulo Terraform.
- `segurasist-infra/modules/security-hub/` — módulo Terraform.
- `segurasist-infra/modules/security-alarms/` — módulo Terraform.
- `segurasist-infra/global/security/main.tf` — org-level GuardDuty + SH + Inspector.
- `docs/adr/ADR-0010-guardduty-findings-triage.md` — severity threshold + auto-suppression.
- `docs/adr/ADR-0006-cloudwatch-alarms-cardinality.md` — single-region alarm policy.
- AWS docs: <https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_finding-types-active.html>
