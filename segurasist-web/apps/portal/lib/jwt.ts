/**
 * JWT helpers shared between the Edge middleware and unit tests.
 *
 * IMPORTANT: `decodeJwtPayload` does NOT verify the signature. It is only
 * used to read non-security claims (the `custom:role` for portal-only
 * gating, the `given_name`/`name`/`email` for the header greeting).
 * Authoritative verification happens in the API on every request.
 */

/** Decode a JWT payload without verifying the signature. Returns `null` for
 * any malformed input. Never throws. */
export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = globalThis.atob(padded);
    const obj = JSON.parse(json) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Extract `custom:role` (falling back to `role`). Returns `null` if absent. */
export function readRoleFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const claim = payload['custom:role'] ?? payload['role'];
  return typeof claim === 'string' ? claim : null;
}

/**
 * Extract a friendly first name from a JWT payload, falling back through
 * the most likely Cognito/OIDC claims:
 *   given_name → name (first token) → email (local-part) → null
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

/** Read the `exp` (seconds since epoch). Returns `null` if absent/invalid. */
export function readExpFromToken(token: string): number | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const exp = payload['exp'];
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
}

/** Returns true when the token is missing, malformed, or past its `exp`. */
export function isTokenExpired(token: string, nowSeconds?: number): boolean {
  const exp = readExpFromToken(token);
  if (exp === null) return true;
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  return now >= exp;
}
