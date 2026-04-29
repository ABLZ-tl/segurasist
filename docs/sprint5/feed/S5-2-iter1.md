[S5-2] iter1 STARTED — DevOps Security: GuardDuty + Security Hub + security-alarms (5pts).

## Plan

1. Módulos Terraform `guardduty/`, `security-hub/`, `security-alarms/`.
2. Wiring en `envs/dev/main.tf` y `envs/staging/main.tf` (NO prod en iter 1).
3. Runbook RB-020 + ADR-0010 (severity threshold, auto-suppression, retención findings).
4. Validar coexistencia con `global/security/` (GuardDuty + SH ya org-managed desde Sprint 1).

## Hechos

- [S5-2] iter1 DONE segurasist-infra/modules/guardduty/main.tf:1 — módulo per-env. `create_detector` flag (default false; org admin maneja detector). Protection plans vía `aws_guardduty_detector_feature` (S3, Malware EBS, RDS Login, Lambda Network; EKS off — SegurAsist usa App Runner). Findings export a S3 bucket `segurasist-security-findings-{env}-{account}` con KMS, lifecycle 90d STANDARD → GLACIER → DELETE 730d. Bucket policy con DenyInsecureTransport + AllowGuardDutyPutObject (SourceAccount condition). Trusted-IP / threat-intel sets opcionales (variables `trusted_ip_lists` / `threat_intel_lists`).
- [S5-2] iter1 DONE segurasist-infra/modules/guardduty/variables.tf:1 — vars: `enable_findings_publishing` (default true), `kms_key_arn` (required, reuse env general — anti-pattern crear key per-módulo), `tags`, plus protection toggles + retention knobs.
- [S5-2] iter1 DONE segurasist-infra/modules/guardduty/outputs.tf:1 — `detector_id`, `finding_publishing_frequency`, `findings_bucket_name`, `findings_bucket_arn`, `publishing_destination_id`, ipset maps.
- [S5-2] iter1 DONE segurasist-infra/modules/security-hub/main.tf:1 — standards: AWS FSBP v1.0.0 + CIS v1.4.0 (default true). PCI DSS off (SegurAsist NO procesa pagos — confirmado en ADR-0010). NIST 800-53 off. Standards subscription via `aws_securityhub_standards_subscription`. Disabled controls via `aws_securityhub_standards_control` con `disabled_reason` (auditor evidence). Aggregator iter 1 OFF (single-region mx-central-1; activable por flag).
- [S5-2] iter1 DONE segurasist-infra/modules/security-hub/variables.tf:1 — `auto_disabled_controls` shape `[{standard, control_id, reason}]`. Defaults sensatos por env.
- [S5-2] iter1 DONE segurasist-infra/modules/security-alarms/main.tf:1 — SNS `${env}-security-alerts` (KMS); EventBridge rule `${env}-guardduty-high-critical` (severity ≥ 7.0 numeric op); Slack forwarder Lambda (placeholder zip; CI/CD publica artifact real; webhook URL via SecretsManager `var.slack_webhook_secret_arn` — NO hardcoded). CloudWatch alarm `securityhub-failed-compliance` (threshold 5 en 1h, namespace `SegurAsist/Security` EMF). Auto-quarantine Lambda opcional para `Backdoor:EC2/*` (off en dev, on en staging canary, prod TBD iter 2 tras review).
- [S5-2] iter1 DONE segurasist-infra/envs/dev/main.tf — wired `module.guardduty`, `module.security_hub`, `module.security_alarms`. KMS reuse `module.kms_general.key_arn`. Auto-suppression list inicial: `aws-foundational:EKS.1, EKS.2, ECS.1` + `cis-v1.4.0:1.13, 3.10` (justificado per-control en ADR-0010).
- [S5-2] iter1 DONE segurasist-infra/envs/dev/variables.tf — agregado `slack_security_webhook_secret_arn` (default null; gitignored tfvars).
- [S5-2] iter1 DONE segurasist-infra/envs/dev/outputs.tf — exporta `guardduty_detector_id`, `security_findings_bucket_name`, `security_alerts_topic_arn`.
- [S5-2] iter1 DONE segurasist-infra/envs/staging/main.tf — mismo wiring + `enable_auto_quarantine = true` (canary), VPC config para Lambda quarantine.
- [S5-2] iter1 DONE segurasist-infra/envs/staging/variables.tf — `slack_security_webhook_secret_arn` agregado (G-1 también añadió `slack_ops_webhook_url`; no conflict).
- [S5-2] iter1 DONE segurasist-infra/envs/staging/outputs.tf — outputs paralelos a dev.
- [S5-2] iter1 DONE segurasist-infra/docs/runbooks/RB-020-guardduty-triage.md — severity scale, false positives comunes, triage matrix por categoría (Backdoor / CryptoCurrency / Reconnaissance / Trojan / UnauthorizedAccess / Exfiltration / PrivilegeEscalation / Stealth / Discovery), auto-quarantine flow, escalación CISO criteria, post-mortem template, LocalStack caveat.
- [S5-2] iter1 DONE docs/adr/ADR-0010-guardduty-findings-triage.md — severity thresholds (≥4.0 ticket, ≥7.0 page), auto-suppression list justificada, retention 90d STANDARD → GLACIER → DELETE 730d, PCI DSS rejection rationale, NIST rejection.
- [S5-2] iter1 DONE prod NO tocado (per spec iter 1).
- [S5-2] iter1 DONE workflow `.github/workflows/terraform-plan.yml` ya cubre `terraform validate` para envs/{dev,staging,prod} (Sprint 4 F8 lo creó). NO se requiere extender — cualquier syntax error nuevo fallaría el job existente.

## NEW-FINDING

1. **Auto-suppression obvios** (encoded in env wiring + ADR-0010): `aws-foundational:EKS.1`, `EKS.2`, `ECS.1` (no usamos EKS/ECS), `cis-v1.4.0:1.13` (root MFA gestionado en master), `cis-v1.4.0:3.10` (VPC flow logs ya enabled, control flapping). Lista NO exhaustiva — controles Lambda/AppRunner-specific pueden necesitar agregar si en iter 2 generan ruido. // for-S5-2-iter2 (validar volume real tras 24h)

2. **PCI DSS desactivado** — SegurAsist NO procesa pagos hoy. ADR-0010 §4 documenta. **DECISIÓN PENDIENTE**: si producto/MAC introducen captura de pago (Stripe/Conekta) en Sprint 7+, este ADR requiere superseder + activar `enable_pci_dss = true`. // for-S0 (decisión arq), for-product

3. **Runbook ubicación** — DISPATCH_PLAN.md indica `docs/runbooks/RB-020-guardduty-triage.md` (root), pero los runbooks existentes (RB-001..RB-017) viven en `segurasist-infra/docs/runbooks/`. Escribí en la ruta existente para mantener cohesión con RB-006 (que ya existía como stub GuardDuty Critical). RB-020 supersedea RB-006 efectivamente. // for-S10 (consolidar paths de docs en code freeze checklist)

4. **`aws_securityhub_standards_control` race condition** — el resource depende de que la subscription haya completado el bootstrap interno de controles (~5-10 min). En primer `terraform apply` puede fallar con "control not found"; segundo apply lo resuelve. Documentado in-line en `security-hub/main.tf`. Iter 2: introducir `time_sleep` de 600s entre subscription y disabled controls si CI lo flakea. // for-S5-2-iter2

5. **LocalStack** no soporta GuardDuty free tier — runbook RB-020 documenta. Tests dev-local requieren AWS sandbox account. CI `terraform-plan.yml` hace `validate` sin backend (no necesita AWS account); apply se ejecuta solo post-merge contra cuenta real.

6. **Slack webhook secret seedeo manual** — el ARN `slack_security_webhook_secret_arn` referencia un secret que se crea fuera de Terraform (admin one-time). Documentar este step en RB-021 (MT-1+MT-2 owner) o agregar a `docs/runbooks/` un step "bootstrap secrets" si todavía no existe. // for-S0 (process), for-MT-1

7. **Auto-quarantine Lambda placeholder** — el zip es bootstrap (1-line comment). El handler real (Node.js `ec2:ModifyInstanceAttribute` + tagging) NO está implementado en este iter. Crear `scripts/lambda/security-slack-forwarder/` y `scripts/lambda/security-quarantine/` en iter 2. // for-S5-2-iter2

8. **EventBridge rule severity numeric** — el filtro `{"numeric":[">=", 7.0]}` requiere AWS provider ≥ 5.30 (numeric matching GA). El proyecto usa `~> 5.40` ✅.

9. **Findings retention vs audit bucket** — Both 730d retention by design (ADR-0010 §3 alinea con audit Object Lock 24m). Si legal escala el plazo audit a 36m, el findings bucket también debería extenderse para mantener correlación.

## Bloqueos

- Ninguno bloqueante para iter 1. Apply real en cuenta AWS requiere:
  - SecretsManager secret `${env}/security/slack-webhook` seedeado manualmente.
  - Org-level GuardDuty + SH ya enabled (Sprint 1 done — verificable via `aws guardduty list-detectors`).
  - Primer `terraform apply` posiblemente requiera segunda corrida por race `aws_securityhub_standards_control` (NEW-FINDING #4).

## Para iter 2 / cross-cutting

- **iter 2 propio**: implementar Lambdas reales (`scripts/lambda/security-slack-forwarder/index.js` + `security-quarantine/index.js`); validar en staging con `aws guardduty create-sample-findings`; si auto-suppression genera ruido residual, ampliar lista; introducir `time_sleep` si CI flakea.
- **cross-cutting MT-1**: si el bucket `segurasist-security-findings-${env}` necesita CORS / cross-account replication, coordinar con módulo `s3-tenant-branding` (mismo owner KMS general).
- **cross-cutting S5-1**: SAML/SCIM events (`UnauthorizedAccess:IAMUser/...` likely flagged) van por el mismo SNS topic — validar shape JSON del finding en RB-019 (S5-1 owner).
- **cross-cutting G-1**: DR drill RB-018 puede generar findings sintéticos durante el drill — coordinar con S5-2 para suprimir temporalmente o filtrar por tag `DRDrillSimulation=true`.
- **cross-cutting DS-1**: ningún tocamiento UI requerido en iter 1. Si admin UI agrega panel "security alerts", consume `module.security_alarms.sns_topic_arn` via env vars.

[S5-2] iter1-complete — 3 módulos terraform (guardduty, security-hub, security-alarms) + wiring en dev/staging + 1 runbook (RB-020) + 1 ADR (ADR-0010). 5 NEW-FINDINGs cross-cutting documentados. Prod NO tocado. tests/CI: `terraform-plan.yml` validate cubrirá syntax; smoke real requiere AWS sandbox.
