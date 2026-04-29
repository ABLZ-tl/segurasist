# ADR-0010 — GuardDuty findings triage: severity thresholds, auto-suppression, retention

- **Status**: Accepted (Sprint 5 iter 1, 2026-04-28)
- **Authors**: S5-2 (DevOps Security)
- **Audit refs**: `docs/sprint5/DISPATCH_PLAN.md` §S5-2, `segurasist-infra/modules/guardduty/`, `segurasist-infra/modules/security-hub/`, `segurasist-infra/modules/security-alarms/`, `docs/runbooks/RB-020-guardduty-triage.md` (canónico en `segurasist-infra/docs/runbooks/`).
- **Trigger**: Sprint 5 enabled GuardDuty per-env (org admin already wired in Sprint 1 `global/security/`). Need a written rule set for severity → action mapping, controls auto-suppression, and findings retention; otherwise on-call drowns in noise.

## Context

`segurasist-infra/global/security/main.tf` enabled GuardDuty + Security Hub + Inspector v2 + Config aggregator at the **org level** (Sprint 1, F4 work). Member accounts auto-enable. Sprint 5 S5-2 ships per-env hardening:

- Protection plans (S3, Malware, RDS, Lambda) explicit.
- Findings export to S3 with KMS + lifecycle.
- EventBridge HIGH/CRITICAL → SNS → Slack.
- Auto-quarantine Lambda (Backdoor:EC2/* → SG quarantine).
- Security Hub standards (AWS FSBP, CIS v1.4.0; PCI DSS evaluated and rejected for MVP).

Three architectural questions surfaced:

1. **Severity threshold**: what counts as page-worthy vs ticket-worthy vs log-only?
2. **Auto-suppression**: which Security Hub controls are noise (false positives) and should be suppressed at provisioning time, with a written justification?
3. **Retention**: how long to keep findings in S3, when to archive, when to delete?

Without explicit answers, the team's pattern would be to either (a) page on everything (alert fatigue, real findings missed) or (b) silence all (compliance gap). ADR-0006 already documented alarm cardinality; this ADR is the security-findings-specific complement.

## Decision

### 1. Severity threshold

GuardDuty severity scale 0.1 — 10.0 (AWS-defined). SegurAsist mapping:

| Range | Action | Channel | Owner SLA |
|---|---|---|---|
| `[0.1, 4.0)` LOW | Log only (S3 export, no notification) | None | Weekly review only |
| `[4.0, 7.0)` MEDIUM | Auto-create ticket via workflow `security-findings-triage` (Sprint 6+ — manual until then) | Jira/Linear ticket | ≤ 48h triage |
| `[7.0, 8.9]` HIGH | Page on-call via SNS → Slack | `#security-alerts-${env}` | ≤ 15 min ack, ≤ 1h contain |
| `[9.0, 10.0]` CRITICAL | Page on-call + CISO | Slack + PagerDuty + email CISO | ≤ 15 min ack, IRP P1 (RB-010) |

Implementation: `segurasist-infra/modules/security-alarms/main.tf` EventBridge rule `${env}-guardduty-high-critical` filters `severity >= var.severity_alert_threshold` (default `7.0`). Findings below 7.0 still export to S3 (Athena queryable) but do not page.

### 2. Auto-suppression rules (Security Hub)

The following controls are explicitly disabled at provisioning time, encoded in `auto_disabled_controls` of the `security-hub` module per env. Each entry carries a written `reason` that surfaces in `aws_securityhub_standards_control.disabled_reason`.

| Standard | Control ID | Title (short) | Reason |
|---|---|---|---|
| AWS FSBP | EKS.1 | EKS endpoint should not be publicly accessible | SegurAsist no usa EKS (App Runner managed + Lambda + ECR). El control reporta INFORMATIONAL/FAILED por ausencia de cluster, generando ruido permanente. |
| AWS FSBP | EKS.2 | EKS clusters should run on a supported version | Mismo razón que EKS.1. |
| AWS FSBP | ECS.1 | ECS task definitions should have secure networking | App Runner managed; ECS task definitions no se usan. |
| CIS v1.4.0 | 1.13 | Ensure MFA is enabled for the root user | Gestionado en master account org-level (no per-env). El control reporta FAILED en cuentas member porque el usuario root del member account es deshabilitado por SCP (correcto). |
| CIS v1.4.0 | 3.10 | Ensure VPC flow logging is enabled | El módulo `vpc` ya enabled flow logs (Sprint 1). El delegado admin reporta lag intermitente; suprimimos para evitar flapping. |

**Future suppressions**: cualquier nuevo control suprimido DEBE actualizarse aquí + `auto_disabled_controls` del env. PR review checklist enforce esto.

### 3. Findings retention policy (S3)

| Stage | Class | Days | Cumulative cost (per GB-month) |
|---|---|---|---|
| Hot | S3 STANDARD | 0 — 90 | $0.023 |
| Warm | S3 GLACIER (instant retrieval) | 90 — 730 | $0.004 |
| Expired | DELETE | > 730 | — |

Rationale:
- 90 días hot soporta el caso "investigar findings del último trimestre" sin restore latency.
- 730 días (24 meses) total alinea con el bucket `audit` (Object Lock COMPLIANCE 24m). El equipo legal pidió mantener este match para cualquier disputa contractual.
- GLACIER (no DEEP_ARCHIVE) elegido porque las queries Athena requieren restore time-bounded (~ minutos, no horas) si surge un incidente histórico.
- Versioning enabled + noncurrent_version_expiration 30d para evitar inflar el bucket si GuardDuty re-publica un finding actualizado.

Implementación: `aws_s3_bucket_lifecycle_configuration.findings` en `modules/guardduty/main.tf`.

### 4. PCI DSS standard: NOT enabled

SegurAsist NO procesa pagos directamente. Hospitales MAC factura/cobra fuera del SaaS; el portal SegurAsist solo emite constancias y captura datos asegurado/dependientes. **No hay PAN, CVV, ni data cardholder almacenada o transmitida**. Por tanto:

- PCI DSS standard se deja `enable_pci_dss = false` en todos los envs.
- Si producto introduce captura de pago (Sprint 7+ improbable), revisar este ADR + add-on superseder ADR.
- NEW-FINDING para tracking: cualquier integración futura con Stripe/Conekta/etc reabre esta evaluación.

### 5. NIST 800-53: NOT enabled

Sin clientes federales US. Activar solo si entran tenants gubernamentales mexicanos que requieran framework explícito (CONACYT/IMSS pidieron CIS, no NIST).

## Consequences

### Positive

- **Predictable on-call load**: severity threshold 7.0 produce ~1-3 pages/mes en prod (basado en datasets de cuentas similares). Sin threshold, observed rate sería 50-100/mes (mostly LOW noise).
- **Compliance-aware**: cada control suprimido tiene justificación escrita; auditor externo puede verificar sin re-litigar la decisión.
- **Cost predictable**: 90d STANDARD → GLACIER saves ~80% vs STANDARD-only at scale (~$2/mes para findings volume típico).
- **Slack actionable**: solo ≥7.0 llega al canal → on-call no entrena el ojo a ignorar.

### Negative / trade-offs

- **MEDIUM (4.0-6.9) findings**: hoy NO automatizan ticket creation (requiere workflow Sprint 6+). Mitigación: weekly review es manual; on-call lead revisa Slack/console cada lunes 09:00 CST.
- **PCI rejection** asume modelo de negocio actual; si cambia, este ADR superseder requerido.
- **Auto-suppression** lista no exhaustiva. EKS controls cubrirán el grueso del ruido; controles ECS/Lambda específicos pueden necesitar agregar — gestión via PR + actualizar este ADR.
- **Retention 730d**: si un caso legal requiere > 730d de evidencia, hay que extender lifecycle ANTES de la expiración (no recuperable post-DELETE).
- **Auto-quarantine en staging/prod**: Lambda con `ec2:ModifyInstanceAttribute` es power. Salvaguarda: Lambda solo dispara en `Backdoor:EC2/*` (filtro estricto); además publica `[AUTO-QUARANTINED]` en SNS para revisión humana inmediata. Rollback documentado en RB-020.

## Alternatives considered

### A. Severity threshold 4.0 (page everything MEDIUM+)

Rejected. Volume estimado 50-100 pages/mes; alert fatigue.

### B. Threshold 9.0 (page only CRITICAL)

Rejected. HIGH (7.0-8.9) incluye `Backdoor:EC2/*`, `UnauthorizedAccess:IAMUser/...`, `Trojan:*` — todos requieren respuesta < 1h. Esperar a 9.0 introduce risk window inaceptable.

### C. Habilitar TODOS los standards (FSBP + CIS + PCI + NIST)

Rejected. Cada standard duplica controles overlapping; el costo no es la suscripción (free) sino el ruido de findings duplicados (un mismo recurso falla en 3 frameworks → 3 findings independientes en Slack).

### D. Centralizar findings en log-archive account (sin export per-env)

Rejected para iter 1. El bucket `segurasist-org-cloudtrail` ya recibe CloudTrail; agregar GuardDuty findings al mismo bucket complica las policies KMS y mezcla retention reqs. Iter 2+ evaluar agregador centralizado con replicación cross-account.

### E. Disable auto-quarantine en prod (manual containment only)

Rejected. Backdoor:EC2/* tiene MTTR humano > 30 min en horario nocturno. Auto-quarantine reduce dwell time del attacker. Salvaguardas: filter strict + SNS notification + reversible (manual SG restore).

## Follow-ups

- **S5-2 iter 2**: validar Slack forwarder Lambda funcional en staging; probar end-to-end con un finding sintético (`aws guardduty create-sample-findings`).
- **Sprint 6**: workflow `security-findings-triage` que auto-cree ticket Jira/Linear para MEDIUM. Owner: DevOps + Eng Manager.
- **Sprint 6+**: si tenants govt → re-evaluar NIST 800-53.
- **Sprint 7+**: si introducimos captura de pago → re-evaluar PCI DSS (este ADR superseder).
- **Cualquier sprint**: si on-call reporta auto-suppression de un control que SÍ aplica → reabrir este ADR vía PR + remover de `auto_disabled_controls`.

## References

- `segurasist-infra/modules/guardduty/` — detector features, S3 export, lifecycle.
- `segurasist-infra/modules/security-hub/` — standards subscriptions, disabled controls.
- `segurasist-infra/modules/security-alarms/` — SNS, EventBridge, Slack forwarder, quarantine Lambda.
- `segurasist-infra/global/security/main.tf` — org-level enablement.
- `segurasist-infra/docs/runbooks/RB-020-guardduty-triage.md` — operational runbook.
- ADR-0006 — CloudWatch alarms cardinality (single-region pattern).
- ADR-0009 — SAML SSO strategy (sibling Sprint 5 security ADR).
- AWS GuardDuty severity scale: <https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_findings.html#guardduty_findings-severity>.
