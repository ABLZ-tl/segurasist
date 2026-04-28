import type { NextRequest, NextResponse } from 'next/server';
import {
  clearSessionCookies as clearSessionCookiesShared,
  setSessionCookiesForNames,
} from '@segurasist/security/cookie';
import { REFRESH_COOKIE, SESSION_COOKIE } from './config';
import type { CognitoTokens } from './cognito';

/**
 * Cookie helpers for the Cognito Hosted UI flow used by the admin app.
 *
 * Sprint 4 / B-COOKIES-DRY (audit C-11 + H-06):
 *   - All session cookies now route through `@segurasist/security/cookie`,
 *     which forces `sameSite='strict'` regardless of caller. This closes the
 *     silent-refresh CSRF gap exposed by the legacy `lax` defaults.
 *   - Names (`SESSION_COOKIE` / `REFRESH_COOKIE`) stay here in `./config`
 *     because they're admin-app-specific; the security package does not own
 *     naming, only attribute hardening.
 */

/** Read access token from request cookies. */
export function getAccessTokenFromRequest(req: NextRequest): string | undefined {
  return req.cookies.get(SESSION_COOKIE)?.value;
}

export function getRefreshTokenFromRequest(req: NextRequest): string | undefined {
  return req.cookies.get(REFRESH_COOKIE)?.value;
}

/**
 * Persist tokens as HttpOnly Secure SameSite=Strict cookies on the given
 * response. Single source of strictness: the @segurasist/security factory.
 */
export function setSessionCookies(res: NextResponse, tokens: CognitoTokens): void {
  setSessionCookiesForNames(
    res,
    { sessionCookieName: SESSION_COOKIE, refreshCookieName: REFRESH_COOKIE },
    tokens,
  );
}

export function clearSessionCookies(res: NextResponse): void {
  clearSessionCookiesShared(res, {
    sessionCookieName: SESSION_COOKIE,
    refreshCookieName: REFRESH_COOKIE,
  });
}
