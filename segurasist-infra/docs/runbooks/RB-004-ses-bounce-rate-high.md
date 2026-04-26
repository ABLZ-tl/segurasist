# RB-004 — SES bounce rate > 5%

- Severity: P2 (potential P1 if reputation suspended)
- On-call SLA: acknowledge ≤ 30 min, resolve ≤ 8 h
- Owner: DevOps on-call

## Symptom

> TBD

## Detection

- CloudWatch metric: `AWS/SES BounceRate` > 5%
- SNS topic: `segurasist-{env}-ses-events`

## Diagnosis

> TBD

## Recovery

> TBD

## Postmortem template

- Bounce categories:
- Affected senders:
- Action items:
