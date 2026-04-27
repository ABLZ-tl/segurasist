/**
 * Centralised session cookie configuration for the asegurado portal.
 *
 * Mirrors `apps/admin/lib/cookie-config.ts` (audit items M6 + L3) so the
 * insured-facing app inherits the same hardening posture as the admin SPA:
 *  - L3: `secure` is decided by an explicit allowlist of `NODE_ENV` values
 *    rather than a permissive `=== 'production'` check. Defends against
 *    config drift where the env is `prod`, `production-staging`, etc.
 *  - M6: `sameSite` is hardened to `'strict'`. The portal is a same-origin
 *    proxy (browser → Next.js → backend API) so cookies never need to ride
 *    on cross-site requests; SameSite=Strict closes the top-level POST CSRF
 *    gap that SameSite=Lax leaves open.
 */
const PRODUCTION_LIKE_ENVS: ReadonlySet<string> = new Set(['production', 'staging']);

/**
 * Whether the current process should mark cookies `Secure` (HTTPS-only).
 * Strict allowlist semantics — anything not in the set returns `false`.
 */
export function isSecureContext(): boolean {
  const env = process.env['NODE_ENV'] ?? '';
  return PRODUCTION_LIKE_ENVS.has(env);
}

export interface SessionCookieOptions {
  /** Lifetime in seconds. */
  maxAge: number;
}

export interface SessionCookiePayload {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict';
  path: '/';
  maxAge: number;
}

/**
 * Build a hardened session cookie payload. All session-bearing portal
 * endpoints (otp-verify, logout, future refresh) must use this helper so
 * the security posture stays consistent.
 */
export function buildSessionCookie(
  name: string,
  value: string,
  opts: SessionCookieOptions,
): SessionCookiePayload {
  return {
    name,
    value,
    httpOnly: true,
    secure: isSecureContext(),
    sameSite: 'strict',
    path: '/',
    maxAge: opts.maxAge,
  };
}
