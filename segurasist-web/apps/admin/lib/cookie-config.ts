/**
 * Centralised session cookie configuration.
 *
 * Audit items M6 + L3 land here:
 *  - L3: `secure` is decided by an explicit allowlist of `NODE_ENV` values
 *    instead of a permissive `=== 'production'` check. This prevents config
 *    drift where the env is `prod`, `production-staging`, etc. from silently
 *    disabling the Secure flag and exposing session cookies over plaintext.
 *  - M6: `sameSite` is hardened to `'strict'`. The admin and portal apps are
 *    same-origin proxies (browser → Next.js → backend API), so we never need
 *    cookies to ride on cross-site requests. SameSite=Strict closes the
 *    top-level POST CSRF gap that SameSite=Lax leaves open.
 *
 * Allowlist is intentionally small — defensa contra config drift donde
 * NODE_ENV no es exactamente 'production' (e.g., 'prod', 'production-staging').
 * If a new environment ever needs Secure cookies, add it here explicitly.
 */
const PRODUCTION_LIKE_ENVS: ReadonlySet<string> = new Set(['production', 'staging']);

/**
 * Whether the current process is running in a context where cookies should be
 * marked `Secure` (HTTPS-only). Strict allowlist semantics: any value not in
 * the set returns `false`.
 */
export function isSecureContext(): boolean {
  const env = process.env['NODE_ENV'] ?? '';
  return PRODUCTION_LIKE_ENVS.has(env);
}

export interface SessionCookieOptions {
  /** Lifetime in seconds. */
  maxAge: number;
}

/**
 * Cookie attributes shape compatible with Next.js' `ResponseCookies.set()`.
 * We expose `name` + `value` separately so callers can spread the options
 * object into either positional (`set(name, value, options)`) or single-arg
 * (`set({ name, value, ...options })`) variants.
 */
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
 * Build a hardened session cookie payload. All session-bearing endpoints
 * (login, refresh, logout) must use this helper so the security posture stays
 * consistent across handlers.
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
