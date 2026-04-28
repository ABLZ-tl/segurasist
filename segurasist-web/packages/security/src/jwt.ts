/**
 * Consolidated JWT helpers for `apps/admin` and `apps/portal`.
 *
 * Closes follow-up F7-iter1 NEW-FINDING:
 *   - `apps/{admin,portal}/lib/jwt.ts` were nearly-identical (same
 *     `decodeJwtPayload` + `readRoleFromToken` byte-for-byte) and portal
 *     additionally exposed `readFirstNameFromToken`, `readExpFromToken`,
 *     `isTokenExpired`. The duplication was a drift hazard: a fix to base64url
 *     decoding in admin would silently miss portal (and vice versa). This
 *     module is the single source of truth for unverified JWT decoding.
 *
 * Design rules:
 *   - **Signature is NEVER verified here.** These helpers only read non-security
 *     claims (role for redirect routing, given_name for header greeting, exp
 *     for cheap client-side staleness gating). Authoritative verification
 *     happens in the API on every request.
 *   - **Never throws.** All decode paths return `null` on malformed input
 *     (missing parts, invalid base64url, non-JSON payload, non-object payload,
 *     etc.). Edge runtime callers cannot afford uncaught exceptions in the
 *     middleware path.
 *   - **Edge-runtime + jsdom compatible.** Uses `globalThis.atob`, available in
 *     both environments. No Node Buffer.
 */

/**
 * Decode a JWT payload without verifying the signature. Returns `null` for
 * any malformed input. Generic `T` defaults to `Record<string, unknown>` for
 * call-sites that read individual claims; specialize with a stricter type if
 * the caller knows the shape.
 */
export function decodeJwtPayload<T = Record<string, unknown>>(
  token: string,
): T | null {
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
      return obj as T;
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

/**
 * Read the `exp` claim (seconds since epoch) from a JWT payload. Returns
 * `null` when the claim is absent, non-numeric, or not finite.
 */
export function readExpFromToken(token: string): number | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const exp = payload['exp'];
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
}

/**
 * Returns `true` when the token is missing, malformed, or past its `exp`.
 *
 * `nowSeconds` lets callers inject a fixed time (deterministic tests). When
 * omitted, falls back to `Date.now()`. `skewSeconds` adds an early-expiry
 * safety margin: a token within `skewSeconds` of its `exp` is treated as
 * expired (defensive for clients that may take a few seconds before issuing
 * the next API call).
 */
export function isTokenExpired(
  token: string,
  options: { nowSeconds?: number; skewSeconds?: number } = {},
): boolean {
  const exp = readExpFromToken(token);
  if (exp === null) return true;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = options.skewSeconds ?? 0;
  return now + skew >= exp;
}
