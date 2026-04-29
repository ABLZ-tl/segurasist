/**
 * JWT helpers — portal app facade over `@segurasist/security/jwt`.
 *
 * Closes follow-up F7-iter1 NEW-FINDING: admin↔portal `lib/jwt.ts` were
 * near-duplicates. Base helpers (`decodeJwtPayload`, `readRoleFromToken`,
 * `readExpFromToken`) live in the consolidated package. Portal-only helpers
 * (`readFirstNameFromToken`, the legacy positional `isTokenExpired` signature)
 * stay here.
 *
 * IMPORTANT: `decodeJwtPayload` does NOT verify the signature. It is only
 * used to read non-security claims (the `custom:role` for portal-only
 * gating, the `given_name`/`name`/`email` for the header greeting).
 * Authoritative verification happens in the API on every request.
 */
import {
  decodeJwtPayload,
  isTokenExpired as isTokenExpiredBase,
  readExpFromToken,
  readRoleFromToken,
} from '@segurasist/security/jwt';

export { decodeJwtPayload, readExpFromToken, readRoleFromToken };

/**
 * Extract a friendly first name from a JWT payload, falling back through
 * the most likely Cognito/OIDC claims:
 *   given_name → name (first token) → email (local-part) → null
 *
 * Portal-only: drives the header greeting in the insured-facing layout. Admin
 * has no equivalent because the admin shell shows the tenant name, not a
 * personal greeting.
 */
export function readFirstNameFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const given = payload['given_name'];
  if (typeof given === 'string' && given.trim().length > 0) {
    return given.trim().split(/\s+/)[0] ?? given.trim();
  }
  const name = payload['name'];
  if (typeof name === 'string' && name.trim().length > 0) {
    return name.trim().split(/\s+/)[0] ?? name.trim();
  }
  const email = payload['email'];
  if (typeof email === 'string' && email.includes('@')) {
    const local = email.split('@', 1)[0] ?? '';
    if (local.length > 0) return local;
  }
  return null;
}

/**
 * Extract full display name. Si el JWT trae `given_name` + `family_name`
 * los junta; si solo `name`, lo usa; fallback a email-local-part. Usado
 * por el menú de usuario del header (más completo que `readFirstName`
 * que se queda con el primer token solo para el saludo).
 */
export function readFullNameFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const given = typeof payload['given_name'] === 'string' ? payload['given_name'].trim() : '';
  const family = typeof payload['family_name'] === 'string' ? payload['family_name'].trim() : '';
  if (given && family) return `${given} ${family}`;
  if (given) return given;
  const name = payload['name'];
  if (typeof name === 'string' && name.trim().length > 0) return name.trim();
  const email = payload['email'];
  if (typeof email === 'string' && email.includes('@')) {
    return email.split('@', 1)[0] ?? null;
  }
  return null;
}

/** Extract email claim para mostrar como subtítulo del menú. */
export function readEmailFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const email = payload['email'];
  return typeof email === 'string' && email.includes('@') ? email : null;
}

/**
 * Returns true when the token is missing, malformed, or past its `exp`.
 *
 * Preserves the portal-historic positional signature (`(token, nowSeconds?)`)
 * for backward compatibility with `apps/portal/middleware.ts` and any tests.
 * The package-level `isTokenExpired` exposes a richer options bag (skew); use
 * that import path for new code that needs skew tolerance.
 */
export function isTokenExpired(token: string, nowSeconds?: number): boolean {
  return isTokenExpiredBase(token, { nowSeconds });
}
