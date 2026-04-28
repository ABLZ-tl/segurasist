# ADR-0006 — CloudWatch alarm cardinality: single-region (mx-central-1) + DR exception

- **Status**: Accepted (Sprint 4 hardening, 2026-04-28)
- **Authors**: S9 (formalises F8 Sprint 4 work)
- **Audit refs**: `docs/audit/AUDIT_INDEX.md` C-14 + P6, `docs/fixes/DEVELOPER_GUIDE.md` §1.7
- **Trigger**: F8 instantiated 11 core alarms × 3 envs in Sprint 4. The implicit decision ("single-region except WAF CLOUDFRONT scope") needed a written rationale before Sprint 5 expansion.

## Context

SegurAsist deploys primarily to `mx-central-1` (Mexico City). DR
secondary is `us-east-1` (Virginia) for backup snapshots,
KMS replicas, and the WAF `CLOUDFRONT` scope (which AWS forces to
`us-east-1` regardless of the workload region).

CloudWatch alarms have non-trivial cardinality cost in two axes:

1. **Region**: each alarm exists in one region. Cross-region alarms
   are not GA in `mx-central-1` (CloudWatch Cross-Region Alarms
   GA in `us-east-1`, `eu-west-1`, etc., but `mx-central-1` is
   not on the list as of 2026-04). Multi-region alarming requires
   one alarm per region and an SNS topic per region.
2. **Per-alarm cost**: $0.10/alarm/month + datapoint storage. Trivial
   per-alarm but compounds: 11 alarms × 3 envs × 2 regions = 66 alarms
   ($6.60/mo) — cheap, but the cognitive cost of duplicate
   on-call routing is the real ceiling.

The architectural question: **when do we add a second region's worth
of alarms?**

F8 Sprint 4 deployed:
- All 11 core alarms in `mx-central-1` per env (`dev/staging/prod`).
- The `WAF CLOUDFRONT scope` alarm exists in `us-east-1` (forced by
  AWS); it routes to a second SNS topic `oncall-p1-us-east-1` whose
  email subscriptions match the primary topic.

This was a single decision moment that future agents will encounter
again (e.g., Sprint 6+ cross-region read replica, Sprint 7+ Singapore
region for partner expansion).

## Decision

1. **Default**: alarms live in `mx-central-1`. SNS topic
   `${env}-oncall-p1` per environment. Email subscriptions per
   `var.alert_emails` (rotation list).
2. **Forced exception**: any AWS service that publishes metrics ONLY
   in another region (today: WAF `CLOUDFRONT` scope, ACM certificates
   for CloudFront) gets an alarm in that region with a parallel SNS
   topic `${env}-oncall-p1-${region}`. Email list is the SAME as
   primary (single on-call rotation; the topic is a routing artifact).
3. **DR-secondary**: NO alarms by default in DR region. Rationale:
   DR is cold (no live traffic); the fail-over runbook (RB-003 if/when
   adopted) handles "primary is down" by paging through the primary
   topic, not by waiting for absent metrics in DR.
4. **Multi-region triggers**: add alarms in a second region only when:
   - Active-active traffic split lands (Sprint 6+ likely).
   - A region-specific compliance regulator (e.g. DPDP India) requires
     in-region monitoring evidence.
   - A customer SLA names the region explicitly.
5. **Topic naming**: `${local.name_prefix}-oncall-p1` (mx-central-1
   primary), `${local.name_prefix}-oncall-p1-us-east-1` (DR/CLOUDFRONT
   exception). Consistent with `alarms.tf` resources.
6. **EMF metric dimensions match alarm dimensions**: every custom
   metric (`SegurAsist/Audit/AuditWriterHealth`, `MirrorLagSeconds`,
   `AuditChainValid`) emits `Environment` dimension whose value
   matches `var.environment` (`dev`/`staging`/`prod`). The emitter
   MUST NOT use `process.env.NODE_ENV` (which yields
   `development`/`production` and would cause INSUFFICIENT_DATA on
   the alarm). Sprint 4 cross-check (S9 iter 1) flagged a mismatch;
   the correction is tracked separately (S9-report.md §EMF
   alignment).

## Consequences

### Positive

- Single source of pages: on-call rotation receives one stream of
  alerts (modulo the WAF exception which feels like one stream
  because the email list is shared).
- Cost low: 11 alarms × 3 envs × 1 region = 33 alarms ≈ $3.30/mo.
- Cognitive load minimal: an engineer learning the runbooks doesn't
  need to mentally region-shift.
- Sprint 4 11-alarm core list is the on-call canonical baseline; new
  alarms are additive and localised to `alarms.tf`.

### Negative / trade-offs

- A `mx-central-1` regional outage (rare but real, last incident
  2025-09) leaves on-call blind. Mitigation: `route53-health-check`
  (Sprint 5) probing prod from `us-east-1` routes to a small set of
  DR-region alarms.
- Adding the second region in the future requires duplicating the
  SNS topic + alarm declarations (no shared module yet). Acceptable
  cost when triggered.
- `AWS:SourceAccount` condition on SNS topic policy is per-topic;
  cross-region duplication means duplicating the policy too.

## Alternatives considered

### A. Active-active multi-region from day 1

Rejected. No traffic justifies it; cost is non-trivial (RDS
multi-AZ × 2 regions, CloudFront origins, etc.). Sprint 6+
re-evaluate.

### B. Single SNS topic in `us-east-1` consuming alarms from all
regions

Rejected. CloudWatch alarms cannot cross-region publish to SNS
in regions where Cross-Region Alarms is not GA (mx-central-1 is
not GA). Even where it is GA, the latency and bill are non-zero.

### C. Use Datadog/New Relic instead of CloudWatch

Rejected for Sprint 4 (cost + vendor add). Re-evaluate Sprint 7+ if
team grows beyond ~10 engineers and dashboarding needs outpace
CloudWatch dashboards.

### D. Per-service ownership of alarms (let each module declare its
own)

Rejected. F8 owns observability; centralising in `envs/{env}/alarms.tf`
gives single-PR review for any alarm change. Per-module ownership
re-introduces drift (each team tunes thresholds independently).

## Follow-ups (Sprint 5+)

- Fix EMF emitter `Environment` dimension mismatch (S9 finding):
  emit `var.environment` value (`dev/staging/prod`) not
  `process.env.NODE_ENV` (`development/production`). Open in
  `S9-report.md` for F6 Sprint 5.
- Sprint 5: add Route53 health-check from `us-east-1` probing prod
  endpoint; alarm in `us-east-1` if probe fails (regional outage
  detection).
- Sprint 6+: if active-active lands, document multi-region alarm
  pattern in superseder ADR.
