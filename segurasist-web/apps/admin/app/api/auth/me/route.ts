import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@segurasist/auth';

/**
 * Same-origin proxy for `GET /v1/auth/me`. Reads the access token from the
 * HttpOnly `sa_session` cookie set by `/api/auth/local-login` (or the SSO
 * callback) and forwards it both as a `Bearer` Authorization header and as
 * the `session` cookie the API expects.
 *
 * Returns the upstream JSON body verbatim on 2xx; forwards problem details
 * on non-2xx.
 */

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3000';
const ME_PATH = '/v1/auth/me';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { type: 'about:blank', title: 'No session', status: 401 },
      { status: 401, headers: { 'content-type': 'application/problem+json' } },
    );
  }

  const traceId = req.headers.get('x-trace-id') ?? crypto.randomUUID();

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}${ME_PATH}`, {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        cookie: `session=${token}`,
        'x-trace-id': traceId,
      },
      redirect: 'manual',
    });
  } catch (err) {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Upstream API unreachable',
        status: 502,
        detail: err instanceof Error ? err.message : 'unknown',
        traceId,
      },
      { status: 502, headers: { 'content-type': 'application/problem+json' } },
    );
  }

  const body = await upstream.text();
  const contentType = upstream.headers.get('content-type') ?? 'application/json';
  return new NextResponse(body.length > 0 ? body : null, {
    status: upstream.status,
    headers: { 'content-type': contentType, 'x-trace-id': traceId },
  });
}
