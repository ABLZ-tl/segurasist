# RB-005 — Cross-tenant access attempt detected

- Severity: P1 (security)
- On-call SLA: acknowledge ≤ 15 min, contain ≤ 1 h
- Owner: DevOps on-call + CISO

## Symptom

> TBD — request intentando leer/escribir datos de otro tenant_id.

## Detection

- App log: audit_log entry with `tenant_id_mismatch`
- CloudWatch alarm: `segurasist-{env}-cross-tenant-attempts`

## Diagnosis

> TBD

## Recovery

> TBD (revoke session, contain tenant, audit blast radius)

## Postmortem template

- Affected tenants:
- Customer comms required (≤72h, see breach-notification-template):
- Root cause:
- Remediation:
