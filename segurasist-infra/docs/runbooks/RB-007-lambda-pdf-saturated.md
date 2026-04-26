# RB-007 — Lambda PDF queue backed up

- Severity: P2
- On-call SLA: acknowledge ≤ 30 min, resolve ≤ 8 h
- Owner: DevOps on-call + Backend Sr

## Symptom

> TBD

## Detection

- CloudWatch alarm: `segurasist-{env}-sqs-certificates-depth-high`
- Lambda metric: `Throttles` > 0

## Diagnosis

> TBD

## Recovery

> TBD

## Postmortem template

- Backlog size at peak:
- Time to drain:
- Customer impact (delayed certificates):
