import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import {
  buildSessionCookie,
  clearSessionCookies,
  DEFAULT_REFRESH_MAX_AGE,
  DEFAULT_SESSION_MAX_AGE,
  isSecureContext,
  SESSION_COOKIE_BASE,
  setSessionCookies,
  setSessionCookiesForNames,
} from '../src/cookie';

const SESSION_NAME = 'sa_session';
const REFRESH_NAME = 'sa_refresh';

describe('SESSION_COOKIE_BASE', () => {
  it('locks down httpOnly + sameSite=strict + path=/', () => {
    expect(SESSION_COOKIE_BASE).toEqual({
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });
  });
});

describe('isSecureContext()', () => {
  const original = process.env['NODE_ENV'];
  afterEach(() => {
    if (original === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = original;
  });

  it('returns true for production', () => {
    process.env['NODE_ENV'] = 'production';
    expect(isSecureContext()).toBe(true);
  });

  it('returns true for staging', () => {
    process.env['NODE_ENV'] = 'staging';
    expect(isSecureContext()).toBe(true);
  });

  it('returns false for development', () => {
    process.env['NODE_ENV'] = 'development';
    expect(isSecureContext()).toBe(false);
  });

  it('returns false for typo `prod` (config-drift defense, audit L3)', () => {
    process.env['NODE_ENV'] = 'prod';
    expect(isSecureContext()).toBe(false);
  });

  it('returns false for typo `production-staging`', () => {
    process.env['NODE_ENV'] = 'production-staging';
    expect(isSecureContext()).toBe(false);
  });

  it('returns false when NODE_ENV is unset', () => {
    delete process.env['NODE_ENV'];
    expect(isSecureContext()).toBe(false);
  });
});

describe('buildSessionCookie()', () => {
  beforeEach(() => {
    process.env['NODE_ENV'] = 'production';
  });

  it('emits httpOnly + sameSite=strict + secure cookie payload', () => {
    const payload = buildSessionCookie('sa_session', 'tok-123', { maxAge: 600 });
    expect(payload).toEqual({
      name: 'sa_session',
      value: 'tok-123',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 600,
    });
  });

  it('flips secure off in dev', () => {
    process.env['NODE_ENV'] = 'development';
    const payload = buildSessionCookie('sa_session', 'tok', { maxAge: 60 });
    expect(payload.secure).toBe(false);
  });
});

describe('setSessionCookies()', () => {
  beforeEach(() => {
    process.env['NODE_ENV'] = 'production';
  });

  it('writes BOTH session and refresh cookies as strict + httpOnly + secure', () => {
    const res = NextResponse.next();
    setSessionCookies(res, {
      sessionCookieName: SESSION_NAME,
      refreshCookieName: REFRESH_NAME,
      accessToken: 'at',
      refreshToken: 'rt',
      accessMaxAge: 900,
      refreshMaxAge: 60 * 60 * 24,
    });

    const session = res.cookies.get(SESSION_NAME);
    expect(session?.value).toBe('at');
    expect(session?.httpOnly).toBe(true);
    expect(session?.secure).toBe(true);
    expect(session?.sameSite).toBe('strict');
    expect(session?.path).toBe('/');
    expect(session?.maxAge).toBe(900);

    const refresh = res.cookies.get(REFRESH_NAME);
    expect(refresh?.value).toBe('rt');
    expect(refresh?.sameSite).toBe('strict');
    expect(refresh?.maxAge).toBe(60 * 60 * 24);
  });

  it('does not set a refresh cookie when refreshToken is absent', () => {
    const res = NextResponse.next();
    setSessionCookies(res, {
      sessionCookieName: SESSION_NAME,
      refreshCookieName: REFRESH_NAME,
      accessToken: 'at',
    });
    expect(res.cookies.get(SESSION_NAME)?.value).toBe('at');
    expect(res.cookies.get(REFRESH_NAME)).toBeUndefined();
  });

  it('uses default lifetimes when not provided', () => {
    const res = NextResponse.next();
    setSessionCookies(res, {
      sessionCookieName: SESSION_NAME,
      refreshCookieName: REFRESH_NAME,
      accessToken: 'at',
      refreshToken: 'rt',
    });
    expect(res.cookies.get(SESSION_NAME)?.maxAge).toBe(DEFAULT_SESSION_MAX_AGE);
    expect(res.cookies.get(REFRESH_NAME)?.maxAge).toBe(DEFAULT_REFRESH_MAX_AGE);
  });

  it('emits secure=false in non-production env', () => {
    process.env['NODE_ENV'] = 'development';
    const res = NextResponse.next();
    setSessionCookies(res, {
      sessionCookieName: SESSION_NAME,
      refreshCookieName: REFRESH_NAME,
      accessToken: 'at',
    });
    expect(res.cookies.get(SESSION_NAME)?.secure).toBe(false);
  });
});

describe('setSessionCookiesForNames() — internal compatibility shim', () => {
  beforeEach(() => {
    process.env['NODE_ENV'] = 'production';
  });

  it('delegates to setSessionCookies and applies expires_in as access maxAge', () => {
    const res = NextResponse.next();
    setSessionCookiesForNames(
      res,
      { sessionCookieName: SESSION_NAME, refreshCookieName: REFRESH_NAME },
      { access_token: 'at', refresh_token: 'rt', expires_in: 1234 },
    );
    expect(res.cookies.get(SESSION_NAME)?.maxAge).toBe(1234);
    expect(res.cookies.get(REFRESH_NAME)?.value).toBe('rt');
  });

  it('falls back to DEFAULT_SESSION_MAX_AGE when expires_in missing', () => {
    const res = NextResponse.next();
    setSessionCookiesForNames(
      res,
      { sessionCookieName: SESSION_NAME, refreshCookieName: REFRESH_NAME },
      { access_token: 'at' },
    );
    expect(res.cookies.get(SESSION_NAME)?.maxAge).toBe(DEFAULT_SESSION_MAX_AGE);
  });
});

describe('clearSessionCookies()', () => {
  it('deletes both session and refresh cookies', () => {
    const res = NextResponse.next();
    res.cookies.set(SESSION_NAME, 'a');
    res.cookies.set(REFRESH_NAME, 'b');
    clearSessionCookies(res, {
      sessionCookieName: SESSION_NAME,
      refreshCookieName: REFRESH_NAME,
    });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const sessionExpired = setCookies.find(
      (c) => c.startsWith(`${SESSION_NAME}=`) && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c),
    );
    const refreshExpired = setCookies.find(
      (c) => c.startsWith(`${REFRESH_NAME}=`) && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c),
    );
    expect(sessionExpired).toBeDefined();
    expect(refreshExpired).toBeDefined();
  });
});
