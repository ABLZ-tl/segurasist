# ADR-0002 — `AuditContextFactory` injection strategy

- **Status**: Proposed (Sprint 4 closure, 2026-04-28). Implementation in
  progress by F6 (B-AUDIT bundle).
- **Authors**: F10 (consolidator), F6 (B-AUDIT owner)
- **Audit refs**: `docs/audit/AUDIT_INDEX.md` C-10, H-01, H-02, H-24,
  `docs/audit/06-audit-throttler-v2.md` §A6-31

## Context

The audit (`docs/audit/06-audit-throttler-v2.md`) found that
`{ ip, userAgent, traceId }` extraction for audit logs was duplicated
across **9+ controller methods**, with subtle drift:

- `claims.controller.ts` omits the trio entirely (H-24) — claims
  insured-reported land in the audit log without IP/UA, breaking the
  chain hash invariant for any subsequent forensic.
- `certificates.controller.ts` extracts IP from `req.ip`,
  `auth.controller.ts` from `req.headers['x-forwarded-for']` first.
- `traceId` is sometimes `req.id`, sometimes a `randomUUID()` fallback
  inline.

The proposed remediation (`AuditContextFactory.fromRequest(req)`) lives
in F6's scope; this ADR documents the **decision around its injection
strategy** because that affects callers across modules and tests.

## Decision

1. **`AuditContextFactory` is a regular `@Injectable()` Nest service**
   (singleton scope), exported by `AuditModule`. It exposes:

   ```typescript
   class AuditContextFactory {
     fromRequest(req: FastifyRequest): AuditContext;
   }
   interface AuditContext {
     ip: string | undefined;
     userAgent: string | undefined;
     traceId: string;
   }
   ```

2. **Singleton, NOT request-scoped**, because:
   - Request-scoped services force every consumer up the chain to be
     request-scoped too (Nest DI rule), which would propagate
     unnecessarily to ~20 services/workers.
   - The factory's only state is functions; it reads from the `req`
     argument explicitly, not from a stored `REQUEST` token.

3. **Helper is invoked at the controller**, NOT at the service:
   - Controllers know the request; services receive a plain
     `AuditContext` object as a parameter.
   - This matches the existing pattern used by `auth.controller.ts` and
     `certificates.controller.ts` in Sprint 3 (~10 callers already use
     ad-hoc `{ ip, userAgent, traceId }` extraction inline).

4. **Workers**: build the `AuditContext` from the SQS message metadata
   (the message contains `tenantId` + `actorId`; ip/userAgent are
   `undefined`, traceId is propagated from the producer's audit ctx).

5. **Test pattern**: `AuditContextFactory` is mocked once per module
   spec via `Test.overrideProvider(AuditContextFactory).useValue({
   fromRequest: () => FIXTURE_CTX })`. Integration tests use the real
   factory.

## Consequences

### Positive

- DRY: `{ ip, userAgent, traceId }` extraction lives in ONE function.
- Future header/proxy quirks (e.g. CloudFront `X-Forwarded-For`
  stripping, AWS ALB `X-Amzn-Trace-Id`) are handled uniformly.
- Tests can assert that the factory was invoked (one mock target).
- The `audit-tampering.spec.ts` (F6 iter 2) validates the chain hash
  with a stable ip/userAgent/traceId trio.

### Negative / trade-offs

- One additional `Inject(AuditContextFactory)` per controller — minor
  boilerplate.
- The factory is a Nest service even though it has no IO; an exported
  pure function would also work. We chose Nest service for
  test-mockability uniformity.

### Migration impact

- ~9 controllers updated to inject and call the factory.
- ~9 services that currently take `{ ip, userAgent, traceId }` as
  separate arguments simplify to take `audit: AuditContext`.
- The `AuditWriterService.record` API is unchanged — it already accepts
  `audit?: AuditContext`.

## Alternatives considered

### A. Pure function `extractAuditCtx(req)` in `@common/utils`

Rejected because:

- Loses Nest DI mockability (have to do `vi.mock('@common/utils', ...)`
  in every spec, fragile).
- Loses the natural place to add observability (e.g. count of audit
  contexts created per minute) without touching every caller.

### B. Request-scoped `AuditContextProvider`

Rejected (see point 2 above): forces ~20 downstream services to also
be request-scoped, performance + DI complexity.

### C. Custom Nest decorator `@AuditCtx()` parameter decorator

Promising but rejected for Sprint 4 because:

- Custom param decorators interact awkwardly with Fastify (Nest's
  default is Express; the API is on Fastify).
- The factory function pattern is already used in the codebase
  (e.g. `@Tenant()` is one). Adding `@AuditCtx()` is a Sprint 5
  follow-up if the call-site boilerplate becomes painful.

### D. Build the AuditContext inside `AuditWriterService.record`

Rejected: `record` is called from places without a `req` (workers,
cron jobs); extracting from `req` inside would couple `AuditWriter`
to HTTP context.

## Follow-ups (Sprint 5)

- Evaluate `@AuditCtx()` parameter decorator (alternative C above) once
  the codebase has settled on Fastify and the pattern is stable.
- Add `headers['x-amzn-trace-id']` parsing (multi-segment AWS trace
  IDs) once the API runs behind ALB.
- Extend the factory to fingerprint the user agent (browser vs CLI vs
  service-to-service) for the audit log dashboard.
