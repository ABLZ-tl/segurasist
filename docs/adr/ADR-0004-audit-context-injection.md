# ADR-0004 — AuditContextFactory injection strategy: param-passing for non-request-scoped services

- **Status**: Accepted (Sprint 4 hardening, 2026-04-28)
- **Authors**: S9 (refines ADR-0002 work by F6/F10)
- **Audit refs**: `docs/audit/AUDIT_INDEX.md` H-01, `docs/fixes/DEVELOPER_GUIDE.md` §1.3
- **Related**: ADR-0002 (the canonical request-scoped factory).

## Context

ADR-0002 established `AuditContextFactory` (`@Injectable({ scope: Scope.REQUEST })`)
as the single way to derive `{ ip, userAgent, traceId }` for audit log
entries. Controllers invoke `auditCtx.fromRequest(req)` and forward the
struct to services.

A practical conflict surfaced during Sprint 4 fix bundle B-AUTH-SEC and
H-08 follow-up: **`AuthService` must not be `Scope.REQUEST`**. Login /
refresh / OTP-verify are throughput-critical (target p99 < 250ms,
target throughput 100 req/s). `Scope.REQUEST` services force NestJS to
re-instantiate them per-request, bypassing DI cache; in our profiling
this added 3-5ms overhead per call (Prisma client + Cognito SDK
instantiation dominating). Compounded across login + refresh chain
this is unacceptable.

The same constraint applies to a smaller set of services that NestJS
co-locates with high-frequency endpoints (`HealthService` ping, the
proxy-only `RpcGatewayService` if/when introduced).

The architectural question: **how does a service that is NOT request-scoped
acquire an `AuditContext`?**

Three plausible patterns:

1. **Inject `AuditContextFactory` and call inside the service** — fails
   because `AuditContextFactory` is `Scope.REQUEST`; injecting it into
   a `Scope.DEFAULT` service either upgrades the consumer to REQUEST
   (transitive) or NestJS rejects the graph.
2. **Param-passing**: controller derives ctx, passes as `(dto, ctx)` to
   service method. Service is `Scope.DEFAULT`. The signature change is
   localised to write-paths (where audit entries actually originate).
3. **AsyncLocalStorage-based ambient context**: middleware seeds an ALS
   store with `{ ip, ua, traceId }`; any service reads via a static
   helper. Ergonomic but global mutable state hidden behind sugar.

Sprint 4 chose pattern 2 (param-passing) for `AuthService`,
`InsuredsService`, `CertificatesService`, `ClaimsController` — the
write paths. This ADR formalizes that choice and the criteria for
applying it elsewhere.

## Decision

1. **Default**: services that fit `Scope.REQUEST` (most domain services)
   inject `AuditContextFactory` directly. This is ADR-0002's contract.
2. **Exception**: services that MUST be `Scope.DEFAULT` for performance
   (login throughput, health checks, internal RPC) accept an
   `auditCtx?: AuditContext` parameter on each method that writes audit
   entries. Controllers derive the context via
   `auditCtx.fromRequest(req)` and pass it.
3. **The parameter is `Optional`** (`?: AuditContext`) — a service
   called from a worker (no `req`) passes `undefined`. The audit row
   simply lacks ip/ua/traceId. The audit chain still works; forensics
   degrade gracefully. The DEVELOPER_GUIDE.md §1.3 already documents
   the worker carve-out.
4. **The boundary is enforced by code review**: any service marked
   `Scope.DEFAULT` that calls `auditWriter.record({ ... })` MUST take
   `auditCtx?: AuditContext` on the calling method. PR review checklist
   (DEVELOPER_GUIDE.md §5) flags violations.
5. **No AsyncLocalStorage**: rejected (see Alternatives) but
   re-evaluable in Sprint 6+ if the param-passing surface grows beyond
   ~10 services.

## Consequences

### Positive

- `AuthService` retains application scope: 100 req/s login is not
  bottlenecked by REQUEST-scope DI churn.
- Param-passing is explicit at the call site: a reader can trace where
  ip/ua/traceId originate without `git log` archaeology.
- Workers (insureds-creation, pdf, email, reports) continue to call
  with `undefined` → no synthetic ctx fabrication, the row is
  honestly missing the HTTP fields.
- Tests are easier: the service can be unit-tested with `auditCtx`
  passed explicitly or omitted; no need to bootstrap a request mock
  per test.

### Negative / trade-offs

- Method signatures gain an extra parameter where audit happens.
  Mitigated: only write-path methods get the parameter; read paths
  (`getById`, `list`) do not (no audit row written).
- Two ADRs (0002 + this one) define overlapping rules. Reader must
  understand both; DEVELOPER_GUIDE.md §1.3 is the consolidated
  authority.
- The `Optional` allows callers to forget. Compensating: lint rule
  (Sprint 5) that flags `auditWriter.record({ ... })` without
  `ip|userAgent|traceId` in the same scope — caught at PR.

## Alternatives considered

### A. Make every service `Scope.REQUEST`

Rejected. Throughput regression measured at +30% latency on `/v1/auth/login`
and `/v1/auth/refresh` in synthetic load (k6 100 vu × 60s) due to
per-request Prisma client cache miss. Sprint 5 may revisit if NestJS
introduces a transient DI scope without that cost.

### B. AsyncLocalStorage (ALS) + middleware seed

Rejected for Sprint 4 because:
- Hidden global state is harder to reason about in tests (every spec
  must remember to seed the ALS or risk leaking state across tests).
- ALS perf cost on Node 20 is marginal but non-zero; combined with
  Fastify request lifecycle adds another ~0.5ms.
- Re-evaluate Sprint 6+ when Node 22 LTS lands with cheaper ALS.

### C. Pass the entire `req` through to the service

Rejected. Couples services to Fastify types; breaks worker callers
(no req); makes unit testing require mocking a full Fastify request
shape. Param-passing of the *narrow* `AuditContext` is the right
abstraction.

### D. Singleton `AuditContextFactory` reading from a static field

Rejected. Static mutable state is the ALS antipattern without the ALS
correctness guarantees (no per-request scoping). Concurrency bugs
guaranteed under load.

## Follow-ups (Sprint 5+)

- Lint rule: any `auditWriter.record(...)` call where the lexically
  enclosing function does not receive `auditCtx` and is in a
  `Scope.DEFAULT` service is a warning.
- Sprint 6+: re-evaluate ALS once Node 22 LTS is the deployment target.
- If a 4th service joins the carve-out (currently 3), revisit:
  param-passing scales to ~10; beyond, ALS is justified.
