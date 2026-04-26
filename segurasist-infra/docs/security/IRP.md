# Incident Response Plan (IRP) — SegurAsist

Aligned to NIST SP 800-61 Rev. 2 ("Computer Security Incident Handling Guide").

> Skeleton — full content to be completed in Sprint 1 (CISO).

## 1. Roles and Responsibilities

| Role | Holder | Responsibilities |
|------|--------|------------------|
| Incident Commander (IC) | CISO (primary) / Tech Lead (backup) | TBD |
| Communications Lead | PM | TBD |
| Forensics Lead | DevOps Lead | TBD |
| Customer Liaison | PM + Account Manager | TBD |
| Legal / Compliance | External counsel | TBD |
| Executive Sponsor | Director General | TBD |

## 2. Severities

| Severity | Definition | Acknowledgement | Containment | External notification |
|----------|------------|-----------------|-------------|-----------------------|
| P1 (Critical) | TBD — confirmed breach, PII exposure, prolonged outage | ≤ 15 min | ≤ 1 h | ≤ 72 h (LFPDPPP) |
| P2 (High)     | TBD | ≤ 30 min | ≤ 4 h | Case-by-case |
| P3 (Medium)   | TBD | ≤ 1 h    | next sprint | Internal only |
| P4 (Low)      | TBD | next business day | scheduled | Internal only |

## 3. Phases

### 3.1 Preparation
- TBD: tooling, runbooks, contact tree, tabletop cadence.

### 3.2 Detection & Analysis
- TBD: sources (GuardDuty, Security Hub, audit log, customer reports), triage matrix.

### 3.3 Containment, Eradication & Recovery
- TBD: short-term containment, evidence preservation, eradication, full recovery, validation.

### 3.4 Post-Incident Activity (Lessons Learned)
- TBD: postmortem template, action items, IRP revision cycle.

## 4. Communication Tree

- Internal Slack: `#segurasist-incidents` (auto-paged)
- External customers: see `breach-notification-template.md`
- Regulator (INAI): TBD per LFPDPPP §63
- Subprocessors: TBD per DPA

## 5. Evidence handling

- TBD: chain of custody, S3 evidence bucket (`segurasist-prod-audit-${account_id}`), legal hold procedure.

## 6. Tabletop exercises

- Quarterly minimum.
- Annual full-scope simulation including DR drill.

## 7. Reference

- NIST SP 800-61 Rev. 2
- LFPDPPP México (Ley Federal de Protección de Datos Personales en Posesión de los Particulares)
- Mapeo Seguridad y Cumplimiento — `MVP_08_Seguridad_Cumplimiento_SegurAsist`
