import { NextResponse, type NextRequest } from 'next/server';
import { checkOrigin } from '../../../../lib/origin-allowlist';
import { PORTAL_SESSION_COOKIE, PORTAL_REFRESH_COOKIE } from '../../../../lib/cookie-names';

/**
 * POST /api/auth/portal-logout
 *
 * Best-effort logout:
 *  1. Notify the backend so the refresh token is revoked server-side.
 *     Failures are swallowed — we always clear local cookies even if the
 *     upstream call fails (the user has already requested a sign-out;
 *     leaving cookies behind would be hostile).
 *  2. Clear `sa_session_portal` + `sa_refresh_portal` from this origin.
 */

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3000';
const LOGOUT_PATH = '/v1/auth/logout';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const originCheck = checkOrigin({
    method: req.method,
    pathname: req.nextUrl.pathname,
    origin: req.headers.get('origin'),
  });
  if (originCheck.reject) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }

  const traceId = req.headers.get('x-trace-id') ?? crypto.randomUUID();
  const refreshToken = req.cookies.get(PORTAL_REFRESH_COOKIE)?.value;

  // Fire-and-forget upstream logout. We intentionally `await` so any
  // synchronous errors are caught here (the runtime may otherwise log them
  // as unhandled), but we do not propagate failures to the client.
  if (refreshToken) {
    try {
      await fetch(`${API_BASE}${LOGOUT_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-trace-id': traceId,
        },
        body: JSON.stringify({ refreshToken }),
        redirect: 'manual',
      });
    } catch {
      /* swallow — local cookies still get cleared below. */
    }
  }

  const res = NextResponse.json(
    { ok: true },
    { status: 200, headers: { 'x-trace-id': traceId } },
  );

  // `cookies.set(name, value, { maxAge: 0, path: '/' })` is the documented
  // way to expire a cookie immediately while keeping the same path scope as
  // the original Set-Cookie. `cookies.delete()` works too, but is path-naive.
  res.cookies.set(PORTAL_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  res.cookies.set(PORTAL_REFRESH_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });

  return res;
}
