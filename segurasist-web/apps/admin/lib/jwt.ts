/**
 * JWT helpers — admin app facade over `@segurasist/security/jwt`.
 *
 * Closes follow-up F7-iter1 NEW-FINDING: admin↔portal `lib/jwt.ts` were
 * near-duplicates and one helper drift (e.g. base64url decoding) would have
 * silently regressed only one app. Both apps now re-export from the
 * consolidated package.
 *
 * No admin-only helpers exist today — admin's only consumer (`middleware.ts`)
 * imports `readRoleFromToken`. If admin needs an admin-only helper later
 * (e.g. tenant-aware role logic), add it here below the re-exports rather
 * than back in the package.
 *
 * IMPORTANT: `decodeJwtPayload` does NOT verify the JWT signature. Authoritative
 * verification happens in the API on every request.
 */
export { decodeJwtPayload, readRoleFromToken } from '@segurasist/security/jwt';
