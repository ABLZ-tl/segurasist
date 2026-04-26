import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@segurasist/auth';
import { protectMiddleware } from '@segurasist/auth/middleware';
import { readRoleFromToken } from './lib/jwt';
import { checkOrigin } from './lib/origin-allowlist';

const PUBLIC_PATTERNS = [
  '^/login',
  '^/callback',
  '^/api/auth',
  '^/_next',
  '^/favicon',
  '^/static',
];

const IS_DEV = process.env['NODE_ENV'] !== 'production';

const PORTAL_URL =
  process.env['NEXT_PUBLIC_PORTAL_URL'] ??
  (IS_DEV ? 'http://localhost:3002' : 'https://portal.segurasist.app');

function isPublic(pathname: string): boolean {
  return PUBLIC_PATTERNS.some((p) => new RegExp(p).test(pathname));
}

// JWT decode helpers live in `./lib/jwt` so they are unit-testable without
// booting the Next middleware/edge runtime. See that module for details.

/**
 * Development-mode middleware: trust the presence of `sa_session` without
 * verifying its JWT signature against Cognito. The local stack uses
 * cognito-local whose JWKS is not at `https://cognito-idp.<region>...`, so
 * the production verifier (`@segurasist/auth/middleware`) cannot validate
 * tokens issued there. We still redirect anonymous traffic to /login.
 */
function devMiddleware(req: NextRequest): NextResponse {
  if (isPublic(req.nextUrl.pathname)) return NextResponse.next();
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (session) {
    const redirect = redirectIfInsured(session);
    if (redirect) return redirect;
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

/**
 * If the session belongs to an `insured`, send them to the portal app
 * instead of the admin. Returns `null` to let the regular flow continue.
 * If decode fails we fall through (auth failures are handled by the rest
 * of the middleware).
 */
function redirectIfInsured(token: string): NextResponse | null {
  const role = readRoleFromToken(token);
  if (role === 'insured') {
    return NextResponse.redirect(PORTAL_URL);
  }
  return null;
}

/**
 * Audit M6: enforce an Origin allowlist on mutating requests so that the
 * SameSite=Strict cookie hardening is backed up by an explicit server-side
 * CSRF check. Runs *before* the auth flow because rejecting CSRF takes
 * priority over authenticating the request.
 */
function enforceOrigin(req: NextRequest): NextResponse | null {
  const result = checkOrigin({
    method: req.method,
    pathname: req.nextUrl.pathname,
    origin: req.headers.get('origin'),
  });
  if (!result.reject) return null;
  return NextResponse.json(
    { error: 'Origin not allowed' },
    { status: 403 },
  );
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const blocked = enforceOrigin(req);
  if (blocked) return blocked;

  if (IS_DEV) return devMiddleware(req);

  // Production: run the full Cognito verifier first; if it returns a non-redirect
  // (i.e. authenticated), perform the role-based portal redirect on top.
  const res = await protectMiddleware(req, {
    loginPath: '/login',
    publicPathPatterns: PUBLIC_PATTERNS,
  });
  if (isPublic(req.nextUrl.pathname)) return res;
  // protectMiddleware returns NextResponse.redirect for unauthenticated;
  // skip the role check in that case.
  if (res.headers.get('location')) return res;

  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (session) {
    const redirect = redirectIfInsured(session);
    if (redirect) return redirect;
  }
  return res;
}

// Apply to everything except static assets, handled by the matcher pattern.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
