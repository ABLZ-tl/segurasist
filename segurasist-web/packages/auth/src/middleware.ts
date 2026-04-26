import { NextResponse, type NextRequest } from 'next/server';
import { refreshTokens, verifyAccessToken } from './cognito';
import {
  clearSessionCookies,
  getAccessTokenFromRequest,
  getRefreshTokenFromRequest,
  setSessionCookies,
} from './session';

export interface ProtectOptions {
  loginPath?: string;
  /** Routes that bypass auth entirely (regex strings). */
  publicPathPatterns?: string[];
}

const DEFAULT_PUBLIC = [
  '^/login',
  '^/callback',
  '^/api/auth',
  '^/_next',
  '^/favicon',
  '^/static',
  '^/public',
];

/**
 * Reusable Next.js middleware that:
 *  - lets public paths through,
 *  - validates the access token via Cognito JWKS,
 *  - on expiry, attempts to refresh and re-set cookies in the response,
 *  - on failure, redirects to /login.
 *
 * Use it from `apps/<app>/middleware.ts`:
 *
 *   export { protectMiddleware as middleware } from '@segurasist/auth/middleware';
 *
 * or wrap it to inject app-specific options.
 */
export async function protectMiddleware(
  req: NextRequest,
  options: ProtectOptions = {},
): Promise<NextResponse> {
  const { loginPath = '/login', publicPathPatterns = DEFAULT_PUBLIC } = options;
  const path = req.nextUrl.pathname;
  if (publicPathPatterns.some((p) => new RegExp(p).test(path))) {
    return NextResponse.next();
  }

  const access = getAccessTokenFromRequest(req);
  if (access) {
    try {
      await verifyAccessToken(access);
      return NextResponse.next();
    } catch {
      /* fall through to refresh */
    }
  }

  const refresh = getRefreshTokenFromRequest(req);
  if (refresh) {
    try {
      const tokens = await refreshTokens(refresh);
      const res = NextResponse.next();
      setSessionCookies(res, tokens);
      return res;
    } catch {
      /* fall through to redirect */
    }
  }

  const url = req.nextUrl.clone();
  url.pathname = loginPath;
  url.searchParams.set('next', path);
  const res = NextResponse.redirect(url);
  clearSessionCookies(res);
  return res;
}
