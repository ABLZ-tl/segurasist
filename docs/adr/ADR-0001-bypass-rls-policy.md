# ADR-0001 — `PrismaBypassRlsService` policy & runtime guard

- **Status**: Accepted (Sprint 4 closure, 2026-04-28)
- **Authors**: F10 (Sprint 4 fix bundle B-BYPASS-AUDIT)
- **Audit refs**: `docs/audit/AUDIT_INDEX.md` H-14, `docs/audit/02-multitenant-rls-v2.md` §A2-04

## Context

The backend exposes two Prisma clients:

1. `PrismaService` (rol DB `segurasist_app`, NOBYPASSRLS, request-scoped):
   each query is implicitly filtered by `app.current_tenant` set by the
   `JwtAuthGuard`. This is the default and covers ~95% of the codebase.

2. `PrismaBypassRlsService` (rol DB `segurasist_admin`, BYPASSRLS,
   application-scoped): bypasses RLS entirely. Required for:
   - **Superadmin endpoints** (`@Roles('admin_segurasist')`) that
     legitimately read/write across tenants (e.g. `GET /v1/tenants`,
     `GET /v1/audit/log` cross-tenant).
   - **Background workers** (no HTTP context, application-scoped):
     `pdf-worker`, `email-worker`, `reports-worker`,
     `insureds-creation-worker`, `layout-worker`, `mailpit-tracker`. These
     handle SQS messages signed with a `tenantId` field that they apply
     **explicitly** in every query.
   - **Pre-tenant lookups** in `AuthService.findInsuredByCurp` (the
     OTP-request flow happens before the JWT exists).

The audit (H-14) found **16 callers** injecting `PrismaBypassRlsService`
without:

- A documented architectural decision (this ADR).
- A runtime defense-in-depth check that the actor really is a platform
  admin (the JSDoc said "verify role before using bypass" but did not
  enforce).

A regression in any `@Roles(...)` decorator at any of the 16 endpoints
could silently expose cross-tenant data.

## Decision

1. **Add `assertPlatformAdmin(user)` runtime guard**
   (`src/common/guards/assert-platform-admin.ts`). The helper:
   - Accepts `user.role === 'admin_segurasist'` OR
     `user.platformAdmin === true` (both representations exist in the
     codebase today; consolidation is a Sprint 5 follow-up).
   - Throws `ForbiddenException('platform_admin role required')` otherwise.
   - Is a TypeScript `asserts` type predicate so the type narrows after
     a successful call.

2. **Invocation policy**:
   - **HTTP endpoints** that route to a service using
     `PrismaBypassRlsService`: invoke `assertPlatformAdmin(req.user)`
     either at the controller method (simple endpoints) or inside the
     `buildScope`/`toCtx` helper that flips `platformAdmin: true`. This
     lives **after** the `@Roles()` decorator (defense-in-depth, not a
     replacement).
   - **Background workers**: SKIP the helper (no HTTP actor). Each
     worker MUST:
     - File-level JSDoc comment justifying bypass.
     - Explicit `tenantId = msg.tenantId` filter in every query.
     - Cross-tenant integration test
       (`test/integration/bypass-rls-defense.spec.ts`, owned by F9).
   - **Pre-tenant auth lookups** (`AuthService.findInsuredByCurp` for
     OTP request): SKIP the helper. The control plane is rate-limit +
     IP throttle + structured log of the lookup attempt. Documented
     inline.

3. **Test coverage**: `test/unit/common/guards/assert-platform-admin.spec.ts`
   covers the truth table; controller integration tests assert that
   downgraded JWTs (admin_mac with `bypassRls=true` forced) get 403 from
   any endpoint that uses the bypass branch.

4. **Module visibility**: `PrismaBypassRlsService` remains exported by
   `PrismaModule` (no boundary change) — gating it via Nest module
   visibility was considered but rejected (workers and AuthService need
   it without going through a controller, and Nest modules don't allow
   per-method gating).

## Consequences

### Positive

- The 16 callers are now uniformly guarded at runtime; a regression in
  `@Roles()` no longer leaks cross-tenant data silently.
- The helper is a single source of truth for "is this user a platform
  admin?" — future representations of role can be added in one place.
- Workers' bypass usage is explicitly justified per-file (audit trail
  for any future security review).
- The DEVELOPER_GUIDE.md cheat-sheet documents the contract for new
  endpoints.

### Negative / trade-offs

- Tests that intentionally exercise the bypass path with a non-superadmin
  actor must mock `req.user` accordingly (existing tests already use
  the AuthUser fixture; minimal churn).
- The double check (RolesGuard + assertPlatformAdmin) adds a tiny
  overhead per request. Negligible (<10 µs) compared to DB roundtrip.
- Two representations of "platform admin" continue to coexist
  (`role === 'admin_segurasist'` vs `platformAdmin === true`). This ADR
  accepts the duplication for Sprint 4 and references the consolidation
  as a Sprint 5 follow-up.

## Alternatives considered

### A. Nest custom guard `@RequiresPlatformAdmin()` decorator

A class-level decorator that runs before `RolesGuard`. Rejected because:

- It still doesn't run inside services / workers, where the actual
  `prismaBypass.client.*` call lives.
- It duplicates `@Roles('admin_segurasist')` semantics.

### B. Move bypass into a dedicated module exported only to a `SuperadminModule`

Rejected because workers (application-scoped, no HTTP context) need
the client, and the worker module would have to be a child of
`SuperadminModule` — counter-intuitive ownership.

### C. Make `PrismaBypassRlsService` request-scoped and accept user as
constructor arg

Rejected because workers run outside HTTP context (no request to
inject) and changing scope to REQUEST would break worker DI.

### D. Add a method on `PrismaBypassRlsService` like
`clientForUser(user)` that throws

Rejected: forces every caller to plumb the user through an extra layer
even where it's not naturally available (e.g. `AuthService.findInsuredByCurp`
runs pre-tenant). The standalone helper is more flexible.

## Follow-ups (Sprint 5+)

- Consolidate `role === 'admin_segurasist'` and `platformAdmin === true`
  into a single representation (likely a JWT-derived flag on the
  `AuthUser` type).
- Add a CI rule (custom ESLint or Semgrep) that flags any new injection
  of `PrismaBypassRlsService` without a corresponding
  `assertPlatformAdmin` call OR a worker-class annotation.
- Add a Datadog metric counting `assertPlatformAdmin` 403s per endpoint;
  alert if non-zero (would indicate a guard misconfiguration in
  production).
