import { NextResponse, type NextRequest } from 'next/server';
import { REFRESH_COOKIE, SESSION_COOKIE } from '@segurasist/auth';
import { checkOrigin } from '../../../../lib/origin-allowlist';

/**
 * POST /api/auth/local-logout
 *
 * Best-effort logout for the admin app:
 *  1. Notifica al backend para que revoque el refreshToken server-side
 *     (`POST /v1/auth/logout`). Si falla, la cookie local igual se limpia
 *     (no abandonar al usuario con sesión activa después de pedir salir).
 *  2. Limpia `sa_session` + `sa_refresh` de este origen.
 *
 * Mirror del `portal-logout` con cookie names del admin pool.
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
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;

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

  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  res.cookies.set(REFRESH_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });

  return res;
}
