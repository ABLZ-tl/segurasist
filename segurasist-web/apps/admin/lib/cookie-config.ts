/**
 * Admin app's session cookie configuration. Sprint 4 / B-COOKIES-DRY
 * (audit H-19): the implementation lives in `@segurasist/security/cookie`
 * so admin and portal share a single hardened factory. This file is kept as
 * a thin re-export so existing imports (`buildSessionCookie`, `isSecureContext`,
 * type aliases) continue to compile without churn.
 *
 * If you're adding a new caller, prefer importing directly from
 * `@segurasist/security/cookie`.
 */
export {
  buildSessionCookie,
  isSecureContext,
  type SessionCookieOptions,
  type SessionCookiePayload,
} from '@segurasist/security/cookie';
