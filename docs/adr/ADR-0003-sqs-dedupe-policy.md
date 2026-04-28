# ADR-0003 — SQS Dedupe Policy: standard + DB UNIQUE vs FIFO migration

- **Status**: Accepted (Sprint 4 hardening, 2026-04-28)
- **Authors**: S9 (Sprint 4 hardening; references work F4 + F5 iter 1+2)
- **Audit refs**: `docs/audit/AUDIT_INDEX.md` C-09 + P1, `docs/fixes/DEVELOPER_GUIDE.md` §1.2
- **Supersedes**: implicit "FIFO with MessageDeduplicationId" assumption pre-Sprint 4

## Context

Pre-Sprint-4 the codebase passed `MessageDeduplicationId` to
`SqsService.sendMessage()` for every enqueue (5 callers: `batches.service`,
`insureds-creation-worker`, `layout-worker`, `mailpit-tracker`,
`reports-worker`). The cookie-cutter was: "send a deterministic dedupe ID
and SQS will eat duplicates for free".

This was wrong on two layers:

1. **All SegurAsist queues are AWS SQS *standard*** (not FIFO). Standard
   queues silently ignore the `MessageDeduplicationId` parameter. AWS
   accepts the API call (no error), but the dedupe is never applied. The
   value is dropped on the floor; the second message is delivered.
   LocalStack tolerates the parameter too — masking the bug in dev/test.
   AWS production rejects the parameter on FIFO-only options
   (`InvalidParameterValue`) only when `MessageGroupId` is also passed.
2. **The natural key for idempotency is in our domain**: a CURP belongs
   to exactly one insured per tenant; an export request has one row per
   download URL; a batch row has a `(tenant_id, batch_id, row_number)`
   triple. These already exist in our schema and are unique by business
   semantics. SQS dedupe was a band-aid on top.

C-09 closure (F5 + F4) eliminated the parameter from the SDK signature
and added DB UNIQUE constraints + `INSERT … ON CONFLICT DO NOTHING` in
the workers. Sprint 4 confirmed this works — the migration
`20260428_insureds_creation_unique` is the source of truth.

The open architectural question this ADR resolves: **do we ever migrate
to FIFO?**

## Decision

1. **Standard queues + DB-side idempotency is the canonical pattern**
   for SegurAsist. Every new SQS-driven flow MUST:
   - Use `SqsService.sendMessage(queueUrl, payload)` with no dedupe
     parameter (the parameter has been removed from the signature, so
     this is enforced by the type system).
   - Provide a UNIQUE constraint or PARTIAL UNIQUE INDEX on the natural
     key in the consuming table (`(tenant_id, …)` minimum).
   - Implement consumer-side `INSERT … ON CONFLICT DO NOTHING` BEFORE
     side-effecting work (or wrap the work in the same transaction with
     a CAS update).
   - Provide a "no propagation" unit test (the F5 pattern: ensure that
     a caller forcing `dedupeId` via TS cast does not reach the SDK).
2. **FIFO migration is justified only when ordering is required**, not
   for dedupe. Concrete triggers for considering FIFO:
   - **Audit timeline** (Sprint 5+) needs strict per-tenant ordering
     across multiple writers — candidate.
   - **Chat message stream** (S4-05/06 Sprint 4) requires ordering of
     bot/user messages within a session — candidate but Redis/Postgres
     stream may be a better fit.
   - **Saga compensation flows** (Sprint 6+) where rollback ordering
     matters.
3. **Migration cost** if/when FIFO is adopted: `RB-014-sqs-topic-rename-drain.md`
   already documents the drain procedure. New FIFO queues co-exist with
   standard queues during transition; consumers detect via env var.
4. **Documentation lock**: `DEVELOPER_GUIDE.md` §1.2 + §2.2 cheat-sheet
   are the operational source of truth. Any deviation requires a
   superseding ADR.

## Consequences

### Positive

- Idempotency is enforced at the data layer where it is genuinely
  durable; SQS visibility/redrive are no longer load-bearing for
  correctness.
- Cost: standard queues are cheaper per million messages and have
  higher throughput limits than FIFO.
- The `dedupeId` removal is enforced at the type level; future agents
  cannot reintroduce the antipattern by accident.
- Tests are simpler: no need to reason about SQS-side dedupe windows
  (FIFO's 5-minute dedupe is not 24h) when verifying idempotency.

### Negative / trade-offs

- DB-side idempotency requires a primary index hit per message — small
  cost (~1ms) but not zero.
- Cross-queue ordering (e.g. layout-worker emits → insureds-creation
  consumes) is best-effort; consumers must tolerate out-of-order
  arrival. This is already the design.
- Migrating any single flow to FIFO later requires a new queue + drain;
  cannot be done in-place.

## Alternatives considered

### A. Migrate all queues to FIFO immediately

Rejected. Throughput cap (3000 msg/s/group with batching, 300/s
without) and 256 KB max message size are real constraints; we hit
either when batch processing scales. DB-side dedupe has no such cap.

### B. Keep `MessageDeduplicationId` parameter and treat it as no-op
documentation hint

Rejected. Silent no-ops are the failure mode that produced C-09 in the
first place. Removing the parameter from the signature is the only way
to make the contract honest.

### C. Build a generic "idempotency table" middleware that intercepts
every SQS handler

Rejected. Different flows have different natural keys; a one-size-fits-all
table loses semantic meaning ("which row in which batch?" vs "which
export?"). Per-resource UNIQUE is more readable and indexable.

### D. Use Redis SET-NX with TTL as idempotency layer

Rejected. Loses durability across Redis restart; introduces a second
source of truth for state already in Postgres; cache-coherency adds
complexity without benefit.

## Follow-ups (Sprint 5+)

- Add Semgrep/ESLint rule that flags any reintroduction of
  `MessageDeduplicationId` literal in source.
- Audit timeline ordering decision (Sprint 5): if FIFO is chosen,
  document the migration in a follow-up ADR (ADR-00xx-audit-fifo-migration).
- Operational: review DLQ depth alarms quarterly; redrive-to-source
  pattern (RB-004) assumes idempotent consumers — this ADR ratifies
  that assumption.
