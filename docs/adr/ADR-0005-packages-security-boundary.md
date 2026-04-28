# ADR-0005 — `@segurasist/security` package boundary: workspace vs NPM private

- **Status**: Accepted (Sprint 4 hardening, 2026-04-28)
- **Authors**: S9 (formalises F7 Sprint 4 work)
- **Audit refs**: `docs/audit/AUDIT_INDEX.md` H-19 + P2 + P7, `docs/fixes/DEVELOPER_GUIDE.md` §1.1, §1.8
- **Trigger**: F7 created `segurasist-web/packages/security/` consolidating `cookie.ts`, `origin.ts`, `proxy.ts`, `jwt.ts`. Sprint 5 may publish to a private artifactory; this ADR pins the Sprint 4 decision.

## Context

Pre-Sprint-4 four files were byte-identical between `apps/admin/lib/`
and `apps/portal/lib/`: `cookie-config.ts`, `origin-allowlist.ts`,
`jwt.ts`, plus a near-duplicate proxy handler. This caused C-11
(silent refresh `sameSite='lax'` regression) and H-06/H-07 (cookie
+ logout drift across apps).

F7's fix consolidated the duplicates into a workspace package
`@segurasist/security` consumed via `pnpm workspace:*` protocol; both
`apps/admin` and `apps/portal` re-export from
`lib/{cookie-config,origin-allowlist}.ts` (thin shims preserving API).
Tests (60) live in the package; coverage threshold 80/75/80/80
(security-critical tier per ADR-0006).

The architectural question for Sprint 5+: **should the package move
to a private NPM registry (CodeArtifact, Verdaccio, or GitHub
Packages)?**

Arguments for NPM private:
- Versioning: `@segurasist/security@1.2.3` with semver and changelog.
- Consumers outside the monorepo (a future mobile app, third-party
  partner integration, Pinpoint Lambda extension) could install from
  registry without pulling the whole monorepo.
- Stronger boundary: external consumers can't `import` internal
  utilities by accident.

Arguments against:
- Publish pipeline overhead: every change to `@segurasist/security`
  requires a publish step before downstream apps see the update.
- Refactoring tax: cross-package refactors that span
  `@segurasist/security` + `apps/admin` become 2-PR dances.
- Pre-Sprint-5, no consumer outside the monorepo exists.
- Local dev loop slower (`pnpm install` after publish vs symlink).

## Decision

1. **Sprint 4 + Sprint 5: keep `@segurasist/security` as a pnpm
   workspace package** (current state). No registry publish.
2. **Trigger to revisit**:
   - First non-monorepo consumer materialises (mobile app, Lambda
     extension, partner SDK).
   - The monorepo grows beyond 5 web apps (currently 2: admin + portal).
   - Cross-team contribution model emerges (SegurAsist ↔ a sister
     product) requiring versioned API contracts.
3. **Until trigger**: the package follows monorepo refactor norms.
   API stability is enforced by:
   - Public API surface listed in `packages/security/src/index.ts`
     (exports curated; internal helpers do not appear here).
   - `tsup` build with `dts: true` produces declaration files for
     downstream consumers.
   - Coverage gate 80/75/80/80 (ADR-0006).
4. **No `peerDependencies` shenanigans**: the package depends on
   `next` and `cookie` directly; `apps/*` accept that as
   `dependencies` not `peerDependencies` (peer-deps add zero value
   inside a workspace).
5. **Naming**: `@segurasist/security` (scope owned by the org).
   Avoid generic names that conflict with public NPM registry.

## Consequences

### Positive

- Iteration speed retained: change in `packages/security` is visible
  to `apps/{admin,portal}` immediately via pnpm symlink. Hot reload
  works cross-package.
- No publish pipeline maintenance pre-Sprint-5; team focus stays on
  product features.
- Public API discipline enforced via curated `index.ts` + types;
  `tsup` build catches accidental leaks.
- Tests (60 currently) co-located with the code: 1 package = 1 test
  surface.

### Negative / trade-offs

- Cannot share the package with a future external consumer without
  refactoring (publish + version) — accepted, deferred.
- Monorepo mass increases (~10kloc in `packages/`); `pnpm install`
  fully cold takes 15s extra. Not a concern at current scale.
- `@segurasist/security` API drift across `apps/admin` and
  `apps/portal` is structurally impossible (single import) —
  positive, unintended.

## Alternatives considered

### A. Publish to GitHub Packages immediately

Rejected. No consumer outside the monorepo today. The publish
pipeline + token rotation + retention policies are real ops cost
that buys nothing this sprint.

### B. Verdaccio self-hosted

Rejected. Operational ownership: another service to monitor + back
up. Workspace pattern delivers all in-monorepo benefits without the
infra cost.

### C. Inline the code back into `apps/{admin,portal}/lib/`

Rejected. Reintroduces P2 + P7 antipatterns (the original drift bug).
Sprint 4 fixes were the response to exactly that.

### D. Mono-package `@segurasist/web-shared` containing security +
i18n + ui + api-client

Rejected. Each package has its own coverage tier and review owner
(security: F7; ui: F10; api-client: F9). Bundling loses ownership
clarity.

## Follow-ups (Sprint 5+)

- Track external consumer signals; if a Lambda extension or partner
  SDK needs the cookie helpers, file an ADR successor (ADR-00xx-publish-security-package).
- CI: add `pnpm publish --dry-run` smoke step in
  `packages/security` to guarantee the package is publish-ready
  whenever the trigger fires.
- Doc: append `packages/security/README.md` with the public API list
  + version policy stub (semver intent for the future publish).
