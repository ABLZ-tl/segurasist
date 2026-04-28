# F7 — feed entries iter 2

[F7] 2026-04-28 09:00 iter2 STARTED — jwt consolidation + workspace verification
[F7] 2026-04-28 09:05 iter2 DONE segurasist-web/packages/security/src/jwt.ts — base helpers (decodeJwtPayload<T>, readRoleFromToken, readExpFromToken, isTokenExpired) + 14 tests in test/jwt.spec.ts (~10 target met). Closes F7-iter1 NEW-FINDING #1 (admin↔portal jwt drift).
[F7] 2026-04-28 09:06 iter2 DONE segurasist-web/packages/security/src/index.ts + package.json — `./jwt` subpath export added.
[F7] 2026-04-28 09:08 iter2 DONE segurasist-web/apps/admin/lib/jwt.ts — reduced to re-export of decodeJwtPayload + readRoleFromToken from @segurasist/security/jwt. No admin-only helpers needed (sole consumer is middleware.ts).
[F7] 2026-04-28 09:10 iter2 DONE segurasist-web/apps/portal/lib/jwt.ts — re-exports base helpers; preserves portal-only readFirstNameFromToken locally; isTokenExpired wrapper keeps positional (token, nowSeconds?) signature for backward compat with portal/middleware.ts.
[F7] 2026-04-28 09:12 iter2 DONE segurasist-web/pnpm-workspace.yaml — verified: `packages/*` glob already captures packages/security (no edit needed).
[F7] 2026-04-28 09:14 iter2 DONE segurasist-web/packages/auth/src/middleware.test.ts — verified: C-11 regression assertion (line 81, `expect(sessionCookie).toMatch(/SameSite=Strict/i)`) intact post-F2 + post-F6 (those bundles touched apps/portal/app/api/proxy/[...path]/route.ts and segurasist-api/auth.service.ts respectively, not packages/auth/middleware).
[F7] 2026-04-28 09:15 iter2 NEW-FINDING segurasist-web/apps/admin/test/unit/lib/jwt.test.ts — currently imports decodeJwtPayload + readRoleFromToken via `../../../lib/jwt`. Re-export preserves both symbols byte-for-byte; F0 should run admin test:unit at gate D3 to confirm. No code change needed.
[F7] 2026-04-28 09:16 iter2 iter2-complete — 1 new module (jwt.ts), 1 new test file (14 specs), 2 app facades refactored, 1 workspace cfg verified, 1 regression test verified. Symlinks from iter1 already cover @segurasist/security/jwt subpath (single physical dir).
