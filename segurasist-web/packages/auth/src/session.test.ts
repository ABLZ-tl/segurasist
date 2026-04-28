import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { REFRESH_COOKIE, SESSION_COOKIE } from './config';
import {
  clearSessionCookies,
  getAccessTokenFromRequest,
  getRefreshTokenFromRequest,
  setSessionCookies,
} from './session';
import type { CognitoTokens } from './cognito';

// Sprint 4 / B-COOKIES-DRY: setSessionCookies now delegates to
// `@segurasist/security/cookie`, which gates `secure` via the NODE_ENV
// allowlist (production/staging). These tests pin NODE_ENV=production so
// they assert the real prod-shape cookie attributes.
const ORIGINAL_NODE_ENV = process.env['NODE_ENV'];
beforeEach(() => {
  process.env['NODE_ENV'] = 'production';
});
afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env['NODE_ENV'];
  else process.env['NODE_ENV'] = ORIGINAL_NODE_ENV;
});

function buildRequest(cookies: Record<string, string> = {}): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest('https://app.example.com/some/path', {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

describe('getAccessTokenFromRequest()', () => {
  it('returns the SESSION_COOKIE value when present', () => {
    const req = buildRequest({ [SESSION_COOKIE]: 'abc.def.ghi' });
    expect(getAccessTokenFromRequest(req)).toBe('abc.def.ghi');
  });

  it('returns undefined when the SESSION_COOKIE is missing', () => {
    const req = buildRequest();
    expect(getAccessTokenFromRequest(req)).toBeUndefined();
  });
});

describe('getRefreshTokenFromRequest()', () => {
  it('returns the REFRESH_COOKIE value when present', () => {
    const req = buildRequest({ [REFRESH_COOKIE]: 'r-token' });
    expect(getRefreshTokenFromRequest(req)).toBe('r-token');
  });

  it('returns undefined when the REFRESH_COOKIE is missing', () => {
    const req = buildRequest();
    expect(getRefreshTokenFromRequest(req)).toBeUndefined();
  });
});

describe('setSessionCookies()', () => {
  function makeTokens(overrides: Partial<CognitoTokens> = {}): CognitoTokens {
    return {
      access_token: 'at',
      id_token: 'idt',
      refresh_token: 'rt',
      expires_in: 600,
      token_type: 'Bearer',
      ...overrides,
    };
  }

  it('writes the SESSION_COOKIE and REFRESH_COOKIE with secure HttpOnly attrs', () => {
    const res = NextResponse.next();
    setSessionCookies(res, makeTokens());

    const session = res.cookies.get(SESSION_COOKIE);
    expect(session?.value).toBe('at');
    expect(session?.httpOnly).toBe(true);
    expect(session?.secure).toBe(true);
    // Sprint 4 / B-COOKIES-DRY (C-11): all session cookies must be
    // SameSite=Strict — see packages/security/src/cookie.ts.
    expect(session?.sameSite).toBe('strict');
    expect(session?.path).toBe('/');
    expect(session?.maxAge).toBe(600);

    const refresh = res.cookies.get(REFRESH_COOKIE);
    expect(refresh?.value).toBe('rt');
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.maxAge).toBe(60 * 60 * 24 * 7);
  });

  it('uses fallback maxAge when expires_in is missing', () => {
    const res = NextResponse.next();
    setSessionCookies(res, makeTokens({ expires_in: undefined as unknown as number }));
    expect(res.cookies.get(SESSION_COOKIE)?.maxAge).toBe(60 * 15);
  });

  it('does not set a refresh cookie when refresh_token is absent', () => {
    const res = NextResponse.next();
    setSessionCookies(res, makeTokens({ refresh_token: undefined }));
    expect(res.cookies.get(REFRESH_COOKIE)).toBeUndefined();
  });
});

describe('clearSessionCookies()', () => {
  it('emits Set-Cookie headers expiring SESSION_COOKIE and REFRESH_COOKIE', () => {
    const res = NextResponse.next();
    res.cookies.set(SESSION_COOKIE, 'a');
    res.cookies.set(REFRESH_COOKIE, 'b');
    clearSessionCookies(res);
    const setCookies = res.headers.getSetCookie?.() ?? [
      ...(res.headers.get('set-cookie') ?? '').split(/,(?=\s*[a-zA-Z]+=)/),
    ];
    const sessionExpired = setCookies.find(
      (c) => c.startsWith(`${SESSION_COOKIE}=`) && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c),
    );
    const refreshExpired = setCookies.find(
      (c) => c.startsWith(`${REFRESH_COOKIE}=`) && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c),
    );
    expect(sessionExpired).toBeDefined();
    expect(refreshExpired).toBeDefined();
  });
});
