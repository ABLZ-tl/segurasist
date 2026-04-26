/**
 * JWT helpers shared between the Edge middleware and unit tests.
 *
 * Extracted from `apps/admin/middleware.ts` so the helpers can be exercised
 * without booting Next's middleware machinery (which depends on
 * `next/server` + edge-runtime polyfills). The middleware re-imports these
 * symbols, so behavior is preserved 1:1.
 *
 * IMPORTANT: `decodeJwtPayload` does NOT verify the JWT signature. It is
 * only used to read non-security claims (the `custom:role` for redirect
 * routing). The authoritative verification happens in the API on every
 * request.
 */

/**
 * Decode a JWT payload without verifying the signature. Returns `null` for
 * any malformed input (missing parts, invalid base64url, non-JSON payload,
 * non-object payload, etc.). Never throws.
 *
 * Uses `globalThis.atob`, which is available in both the Edge runtime and
 * jsdom (for tests).
 */
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

/**
 * Extract the SegurAsist role claim from a JWT, falling back to the
 * unqualified `role` if `custom:role` is absent. Returns `null` if the token
 * cannot be decoded or the claim is missing/non-string.
 */
export function readRoleFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const claim = payload['custom:role'] ?? payload['role'];
  return typeof claim === 'string' ? claim : null;
}
