import { NextResponse, type NextRequest } from 'next/server';
import { buildSessionCookie } from '../../../../lib/cookie-config';
import { checkOrigin } from '../../../../lib/origin-allowlist';
import { PORTAL_SESSION_COOKIE, PORTAL_REFRESH_COOKIE } from '../../../../lib/cookie-names';

/**
 * POST /api/auth/portal-otp-verify
 *
 * Same-origin bridge that forwards the OTP code to the backend
 * `/v1/auth/otp/verify` endpoint and, on success, mirrors the returned
 * tokens onto the portal origin as HttpOnly cookies.
 *
 * Tokens are NEVER exposed to client JS — the response body is the minimal
 * `{ ok: true }` so the client only knows whether the verification
 * succeeded; the actual session lives in `sa_session_portal` /
 * `sa_refresh_portal` and is read server-side by the middleware + proxy.
 */

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3000';
const VERIFY_PATH = '/v1/auth/otp/verify';

const SESSION_MAX_AGE = 60 * 15; // 15 minutes
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

interface ApiTokenResponse {
  idToken?: string;
  id_token?: string;
  accessToken?: string;
  access_token?: string;
  refreshToken?: string;
  refresh_token?: string;
  expiresIn?: number;
  expires_in?: number;
}

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
  const rawBody = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}${VERIFY_PATH}`, {
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

  const upstreamText = await upstream.text();

  // Failure: forward the upstream body + status verbatim. We DO NOT touch
  // cookies — a failed verify must never set a session.
  if (!upstream.ok) {
    return new NextResponse(upstreamText.length > 0 ? upstreamText : null, {
      status: upstream.status,
      headers: {
        'content-type':
          upstream.headers.get('content-type') ?? 'application/problem+json',
        'x-trace-id': traceId,
      },
    });
  }

  // Success: parse tokens out of the body and set the portal session cookies.
  let parsed: ApiTokenResponse | null = null;
  if (upstreamText.length > 0) {
    try {
      parsed = JSON.parse(upstreamText) as ApiTokenResponse;
    } catch {
      parsed = null;
    }
  }

  // Prefer the IdToken so downstream Cognito-aware calls see the
  // `custom:role` / `custom:insured_id` claims (the AccessToken usually
  // omits custom claims on Cognito).
  const sessionToken =
    parsed?.idToken ?? parsed?.id_token ?? parsed?.accessToken ?? parsed?.access_token;
  const refreshToken = parsed?.refreshToken ?? parsed?.refresh_token;
  const expiresIn = parsed?.expiresIn ?? parsed?.expires_in;

  if (!sessionToken) {
    // The backend told us 200 but we couldn't extract any token. Surface a
    // 502 so the client doesn't think it's signed in.
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Malformed upstream success response',
        status: 502,
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

  const res = NextResponse.json(
    { ok: true },
    { status: 200, headers: { 'x-trace-id': traceId } },
  );

  res.cookies.set(
    buildSessionCookie(PORTAL_SESSION_COOKIE, sessionToken, {
      maxAge: expiresIn ?? SESSION_MAX_AGE,
    }),
  );
  if (refreshToken) {
    res.cookies.set(
      buildSessionCookie(PORTAL_REFRESH_COOKIE, refreshToken, {
        maxAge: REFRESH_MAX_AGE,
      }),
    );
  }

  return res;
}
