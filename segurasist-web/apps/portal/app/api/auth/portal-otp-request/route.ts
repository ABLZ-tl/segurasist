import { NextResponse, type NextRequest } from 'next/server';
import { checkOrigin } from '../../../../lib/origin-allowlist';

/**
 * POST /api/auth/portal-otp-request
 *
 * Same-origin bridge that forwards the OTP request to the backend
 * `/v1/auth/otp/request` endpoint.
 *
 * The browser cannot call the backend directly because:
 *  - the production CSP `connect-src` only permits `'self'` + the prod API
 *    host (see next.config.mjs);
 *  - the API runs on a different port in development.
 *
 * We re-check the Origin allowlist inside the handler (defense-in-depth on
 * top of the middleware check) so the protection survives if the route is
 * ever invoked outside the middleware path (unit tests, internal callers,
 * future framework changes).
 *
 * The body of the upstream response is forwarded verbatim — the backend is
 * already responsible for anti-enumeration messaging (always 200 with the
 * same generic body shape, regardless of whether the CURP exists).
 */

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3000';
const REQUEST_PATH = '/v1/auth/otp/request';

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

  // Read the raw body so we can forward whatever the client sent without
  // re-shaping it. The backend owns the validation contract.
  const rawBody = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}${REQUEST_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': req.headers.get('content-type') ?? 'application/json',
        'x-trace-id': traceId,
      },
      body: rawBody,
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
      {
        status: 502,
        headers: {
          'content-type': 'application/problem+json',
          'x-trace-id': traceId,
        },
      },
    );
  }

  const respBody = await upstream.text();
  const respHeaders = new Headers();
  respHeaders.set(
    'content-type',
    upstream.headers.get('content-type') ?? 'application/json',
  );
  respHeaders.set('x-trace-id', traceId);

  return new NextResponse(respBody.length > 0 ? respBody : null, {
    status: upstream.status,
    headers: respHeaders,
  });
}
