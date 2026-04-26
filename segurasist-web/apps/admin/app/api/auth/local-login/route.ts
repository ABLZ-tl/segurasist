import { NextResponse, type NextRequest } from 'next/server';
import { REFRESH_COOKIE, SESSION_COOKIE } from '@segurasist/auth';

/**
 * Same-origin bridge for the local credentials login flow (Sprint 1 Day 2).
 *
 * The admin SPA cannot call `http://localhost:3000/v1/auth/login` directly
 * because:
 *  - the production CSP `connect-src` only allows `'self'` + the prod API
 *    host (see next.config.mjs);
 *  - cookies set by the API on `:3000` are not readable from `:3001`.
 *
 * This handler proxies the call server-side, then mirrors the session
 * cookies onto the admin origin under the names that
 * `@segurasist/auth/middleware` already protects (`sa_session`, `sa_refresh`).
 *
 * Body shape: `{ email, password }`. Returns the JSON body of the upstream
 * response on success; on failure forwards the upstream status + RFC 7807
 * problem document so the client can surface a user-friendly message.
 */

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3000';
const LOGIN_PATH = '/v1/auth/login';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

interface ApiTokenResponse {
  accessToken?: string;
  access_token?: string;
  idToken?: string;
  id_token?: string;
  refreshToken?: string;
  refresh_token?: string;
  expiresIn?: number;
  expires_in?: number;
}

function isLoginBody(body: unknown): body is LoginBody {
  return typeof body === 'object' && body !== null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json(
      { type: 'about:blank', title: 'Invalid JSON body', status: 400 },
      { status: 400, headers: { 'content-type': 'application/problem+json' } },
    );
  }

  if (!isLoginBody(parsed) || typeof parsed.email !== 'string' || typeof parsed.password !== 'string') {
    return NextResponse.json(
      { type: 'about:blank', title: 'email and password are required', status: 400 },
      { status: 400, headers: { 'content-type': 'application/problem+json' } },
    );
  }

  const traceId = req.headers.get('x-trace-id') ?? crypto.randomUUID();

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}${LOGIN_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-trace-id': traceId,
      },
      body: JSON.stringify({ email: parsed.email, password: parsed.password }),
      // We are server-side; no `credentials: 'include'` semantics, but we
      // capture Set-Cookie below so the session sticks on :3001.
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

  // Read body once. Best-effort JSON parse; tolerate empty bodies.
  const rawBody = await upstream.text();
  let parsedBody: unknown = null;
  if (rawBody.length > 0) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = null;
    }
  }

  if (!upstream.ok) {
    const contentType =
      upstream.headers.get('content-type') ?? 'application/problem+json';
    return new NextResponse(rawBody.length > 0 ? rawBody : null, {
      status: upstream.status,
      headers: { 'content-type': contentType, 'x-trace-id': traceId },
    });
  }

  const res = NextResponse.json(parsedBody ?? { ok: true }, {
    status: 200,
    headers: { 'x-trace-id': traceId },
  });

  // Strategy A: API returned tokens in the JSON body. Use them.
  // We store the IdToken (not the AccessToken) in `sa_session` because
  // `/v1/auth/me` requires the `custom:tenant_id` claim, which Cognito only
  // emits in the IdToken.
  let sessionToken: string | undefined;
  let refreshToken: string | undefined;
  let expiresIn: number | undefined;
  if (parsedBody && typeof parsedBody === 'object') {
    const t = parsedBody as ApiTokenResponse;
    sessionToken = t.idToken ?? t.id_token ?? t.accessToken ?? t.access_token;
    refreshToken = t.refreshToken ?? t.refresh_token;
    expiresIn = t.expiresIn ?? t.expires_in;
  }

  // Strategy B: API set HttpOnly cookies (`session` / `refresh`). Mirror
  // them onto our origin under the names the middleware expects.
  const setCookieHeaders = upstream.headers.getSetCookie?.() ?? [];
  for (const raw of setCookieHeaders) {
    const firstPair = raw.split(';', 1)[0] ?? '';
    const eq = firstPair.indexOf('=');
    if (eq <= 0) continue;
    const name = firstPair.slice(0, eq).trim();
    const value = firstPair.slice(eq + 1).trim();
    if (!value) continue;
    if (name === 'session' || name === 'sa_session') {
      sessionToken = sessionToken ?? value;
    } else if (name === 'refresh' || name === 'sa_refresh') {
      refreshToken = refreshToken ?? value;
    }
  }

  if (sessionToken) {
    res.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      // Allow over plain http on localhost; production runs over https.
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: expiresIn ?? 60 * 15,
    });
  }
  if (refreshToken) {
    res.cookies.set(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  return res;
}
