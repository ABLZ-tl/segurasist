import type { NextRequest, NextResponse } from 'next/server';
import { REFRESH_COOKIE, SESSION_COOKIE } from './config';
import type { CognitoTokens } from './cognito';

const SESSION_MAX_AGE = 60 * 15; // 15 min
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/** Read access token from request cookies. */
export function getAccessTokenFromRequest(req: NextRequest): string | undefined {
  return req.cookies.get(SESSION_COOKIE)?.value;
}

export function getRefreshTokenFromRequest(req: NextRequest): string | undefined {
  return req.cookies.get(REFRESH_COOKIE)?.value;
}

/**
 * Persist tokens as HttpOnly Secure SameSite=Lax cookies on the given response.
 * This is the only place tokens should ever touch the wire from this app.
 */
export function setSessionCookies(res: NextResponse, tokens: CognitoTokens): void {
  res.cookies.set(SESSION_COOKIE, tokens.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: tokens.expires_in ?? SESSION_MAX_AGE,
  });
  if (tokens.refresh_token) {
    res.cookies.set(REFRESH_COOKIE, tokens.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: REFRESH_MAX_AGE,
    });
  }
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
}
