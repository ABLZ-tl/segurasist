/**
 * Consolidated session cookie factory for `apps/admin` and `apps/portal`.
 *
 * Closes audit items:
 *   - C-11: `packages/auth/src/middleware.ts:64` + `session.ts` were emitting
 *     `sameSite='lax'` cookies on every silent refresh, leaving a CSRF gap on
 *     top-level POSTs. This module is the single source of truth for cookie
 *     attributes and forces `sameSite='strict'`.
 *   - H-06: NextAuth Cognito callback was using the same lax `setSessionCookies`
 *     path. After the migration in `apps/admin/app/api/auth/[...nextauth]`,
 *     the callback also produces strict cookies.
 *   - H-19: 4 byte-identical files (`apps/{admin,portal}/lib/cookie-config.ts`,
 *     `apps/{admin,portal}/lib/origin-allowlist.ts`) consolidated here. The
 *     app-level files keep their public API by re-exporting from this module.
 *
 * Design rules:
 *   - `httpOnly: true` always — JavaScript should never see the session token.
 *   - `secure` is allowlist-based on `NODE_ENV` (defends against config drift
 *     where a typo like `prod` or `production-staging` silently turns Secure
 *     off, leaking cookies over plaintext).
 *   - `sameSite: 'strict'` always — both apps are same-origin proxies (browser
 *     → Next.js → backend), cookies never need to ride cross-site requests,
 *     and Strict closes the top-level POST CSRF gap that Lax leaves open.
 *   - `path: '/'` always.
 */
import type { NextResponse } from 'next/server';

/**
 * Minimal shape required to set cookies. Exposed as an interface so callers
 * outside Next (tests, NextAuth-style integrations) can satisfy it without
 * pulling the framework runtime.
 */
export interface CookieJar {
  set(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'strict' | 'lax' | 'none';
      path: string;
      maxAge: number;
    },
  ): void;
}

/** A response object that carries a `cookies` jar. Compatible with `NextResponse`. */
export interface ResponseWithCookies {
  cookies: CookieJar;
}

const PRODUCTION_LIKE_ENVS: ReadonlySet<string> = new Set(['production', 'staging']);

/**
 * Whether the current process should mark cookies `Secure` (HTTPS-only).
 * Strict allowlist semantics — anything not in the set returns `false`.
 *
 * Audit L3: explicit allowlist instead of `=== 'production'` so that
 * `NODE_ENV=prod` or `production-staging` does not silently emit cookies
 * over plaintext.
 */
export function isSecureContext(): boolean {
  const env = process.env['NODE_ENV'] ?? '';
  return PRODUCTION_LIKE_ENVS.has(env);
}

/** Hardened base attributes that every session-bearing cookie must inherit. */
export const SESSION_COOKIE_BASE = {
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/' as const,
};

export interface SessionCookieOptions {
  /** Lifetime in seconds. */
  maxAge: number;
}

/**
 * Cookie attributes shape compatible with Next.js' `ResponseCookies.set()`.
 * Apps spread this into either the positional (`set(name, value, options)`)
 * or single-arg (`set({ name, value, ...options })`) variants.
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
 * (login, refresh, logout, OTP verify) must use this helper so the security
 * posture stays consistent across handlers.
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

/** Default lifetimes for the session/refresh pair. */
export const DEFAULT_SESSION_MAX_AGE = 60 * 15; // 15 min
export const DEFAULT_REFRESH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface SetSessionCookiesInput {
  sessionCookieName: string;
  refreshCookieName: string;
  accessToken: string;
  refreshToken?: string;
  /** Optional override for access cookie lifetime; defaults to 15 min. */
  accessMaxAge?: number;
  /** Optional override for refresh cookie lifetime; defaults to 7 days. */
  refreshMaxAge?: number;
}

/**
 * Persist access/refresh tokens as HttpOnly Secure SameSite=Strict cookies on
 * the given response. This is the consolidated function — every place that
 * writes a session cookie (Cognito callback, silent refresh, OTP verify,
 * local-login) goes through here.
 */
export function setSessionCookies(
  res: ResponseWithCookies,
  input: SetSessionCookiesInput,
): void {
  const accessMaxAge = input.accessMaxAge ?? DEFAULT_SESSION_MAX_AGE;
  const refreshMaxAge = input.refreshMaxAge ?? DEFAULT_REFRESH_MAX_AGE;
  const secure = isSecureContext();

  res.cookies.set(input.sessionCookieName, input.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: accessMaxAge,
  });

  if (input.refreshToken) {
    res.cookies.set(input.refreshCookieName, input.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: refreshMaxAge,
    });
  }
}

/** Clearable cookie jar (delete-only signature). */
export interface ClearableCookieJar {
  delete(name: string): void;
}

/**
 * Expire the given session/refresh cookie pair on the response.
 */
export function clearSessionCookies(
  res: { cookies: ClearableCookieJar },
  names: { sessionCookieName: string; refreshCookieName: string },
): void {
  res.cookies.delete(names.sessionCookieName);
  res.cookies.delete(names.refreshCookieName);
}

/**
 * Type-narrowing helper used by `@segurasist/auth` so it can keep its
 * existing single-arg signature (`setSessionCookies(res, tokens)`) by
 * delegating here under known cookie names. Not part of the public API
 * surface — apps must use {@link setSessionCookies} directly.
 *
 * @internal
 */
export function setSessionCookiesForNames(
  res: NextResponse,
  names: { sessionCookieName: string; refreshCookieName: string },
  tokens: { access_token: string; refresh_token?: string; expires_in?: number },
): void {
  setSessionCookies(res, {
    sessionCookieName: names.sessionCookieName,
    refreshCookieName: names.refreshCookieName,
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    accessMaxAge: tokens.expires_in ?? DEFAULT_SESSION_MAX_AGE,
  });
}
