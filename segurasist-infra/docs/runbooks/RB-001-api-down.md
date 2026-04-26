# RB-001 — API down (App Runner unhealthy)

- Severity: P1
- On-call SLA: acknowledge ≤ 15 min, resolve ≤ 4 h
- Owner: DevOps on-call

## Symptom

> TBD — completar en sprint 1.

## Detection

- CloudWatch alarm: `segurasist-{env}-apprunner-5xx-rate`
- UptimeRobot status: `status.segurasist.app`
- App Runner service status: `RUNNING` vs `OPERATION_IN_PROGRESS`/`PAUSED`

## Diagnosis

> TBD

## Recovery

> TBD

## Postmortem template

- Timeline (UTC):
- Root cause:
- Detection gap:
- Customer impact:
- Action items (owner, due date):
