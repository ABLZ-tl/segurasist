import { NextResponse, type NextRequest } from 'next/server';
import { checkOrigin } from './lib/origin-allowlist';
import { decodeJwtPayload, isTokenExpired } from './lib/jwt';

/**
 * Portal middleware — insured-only.
 *
 * Responsibilities:
 *  1. Audit M6: enforce same-origin allowlist on mutating requests so the
 *     SameSite=Strict cookie hardening is backed by a server-side CSRF check.
 *  2. Allow public paths through untouched.
 *  3. For everything else, decode (NOT verify) the portal session cookie:
 *     - missing cookie → redirect to /login?next=...
 *     - malformed/expired token → redirect to /login
 *     - role !== 'insured' → redirect to /login?error=admin_must_use_admin_portal
 *     - all OK → next() with `x-insured-id` request header for SCs.
 *
 * The signature is NOT verified here. The backend API re-verifies on every
 * proxied call via `/api/proxy/[...path]`. This middleware is UX-only and
 * runs in the Edge runtime, where pulling Cognito JWKS would add latency.
 *
 * NOTE (CC-01, Sprint 5): CSP / security response headers (`Content-Security-
 * Policy`, `Cross-Origin-*`, `Permissions-Policy`, etc.) live in
 * `next.config.mjs` (`async headers()`) — NOT here. This middleware only
 * enforces request-level guards (origin + cookie) and never attaches CSP.
 */

import { PORTAL_SESSION_COOKIE } from './lib/cookie-names';

const PUBLIC_PATTERNS: readonly RegExp[] = [
  /^\/login(?:$|\/|\?)/,
  /^\/otp(?:$|\/|\?)/,
  /^\/api\/auth(?:$|\/)/,
  /^\/_next(?:$|\/)/,
  /^\/favicon\.ico$/,
  /^\/manifest\.json$/,
  /^\/robots\.txt$/,
  /^\/static(?:$|\/)/,
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATTERNS.some((re) => re.test(pathname));
}

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

function redirectToLogin(
  req: NextRequest,
  opts: { withNext?: boolean; error?: string } = {},
): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  if (opts.withNext) {
    url.searchParams.set('next', req.nextUrl.pathname);
  }
  if (opts.error) {
    url.searchParams.set('error', opts.error);
  }
  const res = NextResponse.redirect(url);
  if (opts.error) {
    // Stale cookies should be cleared so the user can't loop on a bad token.
    res.cookies.delete(PORTAL_SESSION_COOKIE);
  }
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const blocked = enforceOrigin(req);
  if (blocked) return blocked;

  if (isPublic(req.nextUrl.pathname)) return NextResponse.next();

  const token = req.cookies.get(PORTAL_SESSION_COOKIE)?.value;
  if (!token) {
    return redirectToLogin(req, { withNext: true });
  }

  const payload = decodeJwtPayload(token);
  if (!payload || isTokenExpired(token)) {
    return redirectToLogin(req, { withNext: false });
  }

  const role = payload['custom:role'] ?? payload['role'];
  if (typeof role !== 'string' || role !== 'insured') {
    return redirectToLogin(req, {
      withNext: false,
      error: 'admin_must_use_admin_portal',
    });
  }

  // Pass the insured id through so Server Components can render data without
  // re-decoding the cookie themselves. The proxy still uses the cookie+token
  // directly when calling the backend, so this header is informational.
  const insuredId =
    typeof payload['custom:insured_id'] === 'string'
      ? payload['custom:insured_id']
      : typeof payload['sub'] === 'string'
        ? payload['sub']
        : '';

  // Forward an `x-insured-id` request header so Server Components can read
  // it via `headers()` without re-decoding the cookie themselves. Using
  // `NextResponse.next({ request: { headers } })` is the documented way in
  // Next 14 to mutate inbound request headers from middleware.
  const requestHeaders = new Headers(req.headers);
  if (insuredId) requestHeaders.set('x-insured-id', insuredId);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.json).*)'],
};
