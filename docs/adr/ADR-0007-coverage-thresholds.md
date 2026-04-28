# ADR-0007 — Coverage thresholds policy: tiered (60/55 business, 80/75 security-critical)

- **Status**: Accepted (Sprint 4 hardening, 2026-04-28)
- **Authors**: S9 (formalises F9 Sprint 4 work)
- **Audit refs**: `docs/audit/AUDIT_INDEX.md` H-20/H-21 + P4, `docs/fixes/DEVELOPER_GUIDE.md` §1.5, §4
- **Trigger**: Sprint 4 F9 raised real (non-façade) coverage gates; Sprint 5 will discuss escalation. This ADR pins the rules.

## Context

Pre-Sprint-4 the codebase had two failure modes around coverage:

1. **Façade `coverage.include`**: `apps/admin/vitest.config.ts` enumerated
   10 specific files manually. Threshold 80/75/80/80 was cosmetic —
   files with High findings (mobile-drawer, NextAuth catch-all, layout)
   were silently excluded.
2. **`--passWithNoTests`** in `packages/api-client` (26 hooks, zero
   tests).

F9 closed both:
- `coverage.include: ['app/**', 'lib/**', 'components/**']` + curated
  `coverage.exclude` for genuine non-test surface (`layout.tsx`,
  proxy passthrough, NextAuth catch-all that delegates to
  `@segurasist/security`).
- 60/55/60/60 (lines/branches/functions/statements) for business
  modules (admin, portal, BE, api-client, ui).
- 80/75/80/80 for security-critical packages (`packages/auth`,
  `packages/security`).
- `--passWithNoTests` removed; api-client now has 34 tests.

The architectural question Sprint 5+ will face: **when do thresholds
get raised, by how much, and on what evidence?**

A naive "always raise" policy creates pressure to write low-value
tests just to clear the bar. A "never raise" policy locks in Sprint 4
baseline that has known gaps (e.g. workers at 70/65 coverage).

## Decision

1. **Two tiers**:
   - **Business (default)**: 60/55/60/60. Applies to `apps/admin`,
     `apps/portal`, `segurasist-api/jest.config.ts`,
     `packages/api-client`, `packages/ui`.
   - **Security-critical**: 80/75/80/80. Applies to `packages/auth`,
     `packages/security`. NEVER lowered.
   - New packages default to business tier; promotion to
     security-critical requires PR justification (touches auth/CSRF/PII).
2. **Coverage shape**: `coverage.include` MUST be glob patterns
   (`['app/**', 'lib/**']`), not enumerated files. `coverage.exclude`
   may carve out genuine non-test surface (NextAuth catch-all that's a
   1-line proxy, layouts, generated DTOs, types-only files). Manual
   file-by-file `include` is an automatic PR reject.
3. **`--passWithNoTests` is forbidden** in any package containing
   `.ts` source files. Stub test (`expect(true).toBe(true)` with TODO
   issue link) is the escape hatch when adding a brand-new package
   with skeleton code.
4. **Escalation policy**:
   - Business tier 60/55/60/60 → 70/65/70/70 by **end of Sprint 5** if
     Sprint 5 closes its high-priority test bundles (B-TESTS-OTP unit
     suite, B-TESTS-EXPORT, B-TESTS-API-CLIENT extensions).
   - Each escalation requires a measurement at the +0% change baseline
     (run coverage on current `main`, observe headroom). If <5% above
     proposed new threshold, defer.
   - Escalations are PR-gated: a single PR raises the threshold AND
     adds whatever tests close the gap. No "raise the bar then catch
     up" pattern.
5. **Security-critical 80/75/80/80 is permanent**:
   - Lowering is forbidden.
   - Raising to 90/85/90/90 is allowed when the package owner
     confirms the remaining 10-20% is unreachable code (defensive
     try/catch around impossible states, generic error handlers).
6. **Non-coverage gates that complement**:
   - ESLint `eslint --max-warnings=25` (cap warnings, not errors).
   - TypeScript `tsc --noEmit` strict, 0 errors.
   - `--passWithNoTests` ban (above).
   - PR review checklist (`DEVELOPER_GUIDE.md` §5).

## Consequences

### Positive

- Two-tier model is small enough to remember; not enough variance to
  hide gaps.
- Security-critical packages have explicit elevated bar — auditors
  can verify in 30 seconds.
- Escalation tied to measurement prevents "aspirational" thresholds
  that everyone immediately bypasses.
- Façade fixes (selective `include`) are auto-rejected by review
  policy; the antipattern that produced H-20 cannot recur silently.

### Negative / trade-offs

- New packages default to business tier; if they are de-facto
  security-critical (e.g. a future `packages/crypto-helpers`), human
  review must catch the misclassification at PR time.
- 60/55 is genuinely loose for backend services (workers, batches);
  Sprint 5 will face pressure to escalate while still closing
  feature work. Mitigation: escalation policy gates on measurement,
  not aspiration.
- Escalation by sprint cadence assumes regular sprints; in
  hardening or freeze periods, no escalation.

## Alternatives considered

### A. Single threshold for all (60/55/60/60)

Rejected. Auth + cookie utilities are the highest-blast-radius code
in the system; treating them as ordinary business code gives
auditors no signal.

### B. Per-file thresholds

Rejected. Vitest/Jest support per-path thresholds but maintenance
cost is real (drift between path matcher and reality). Two tiers
catch the asymmetry without micro-tuning.

### C. Mutation testing instead of line/branch coverage

Rejected for Sprint 4-5. Stryker/PIT runs are expensive (10-30x
test wall time); CI cost prohibitive at current size. Re-evaluate
Sprint 7+.

### D. No thresholds; rely on PR review

Rejected. The original Sprint 3 audit (P4) confirmed humans miss
silent coverage drops. Mechanical threshold is a tripwire, not a
quality gate.

### E. Dynamically measure delta-coverage on PR (only changed files)

Rejected for Sprint 4. The tooling (`codecov` patch coverage,
`jest-coverage-comment` GitHub Action) is workable but adds CI
complexity. Sprint 5+ candidate.

## Follow-ups (Sprint 5+)

- End-of-Sprint-5 review: measure current coverage on each tier; if
  business tier ≥75% in measurement, raise threshold to 70/65/70/70
  in a single PR.
- Sprint 6+: evaluate delta-coverage on PR (alternative E); if
  adopted, the absolute thresholds become a floor with delta-coverage
  the dynamic gate.
- Maintain ADR-0006-style audit (this one) in sync with
  `DEVELOPER_GUIDE.md` §4 (canonical thresholds list).
- Quarterly: review the security-critical list. If a new package
  lands meeting the criteria (auth/CSRF/PII handling), promote it.
