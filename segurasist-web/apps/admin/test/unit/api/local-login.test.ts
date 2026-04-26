import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../../app/api/auth/local-login/route';

function makeRequest(
  body: unknown,
  init: { headers?: Record<string, string>; raw?: string; omitOrigin?: boolean } = {},
): NextRequest {
  const callerHeaders = init.headers ?? {};
  const baseHeaders: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (init.omitOrigin !== true) {
    // Default Origin matches the dev allowlist so legacy tests still pass
    // through the M6 CSRF check unchanged.
    baseHeaders['origin'] = 'http://localhost:3001';
  }
  const reqInit: RequestInit = {
    method: 'POST',
    headers: { ...baseHeaders, ...callerHeaders },
  };
  if (init.raw !== undefined) {
    reqInit.body = init.raw;
  } else {
    reqInit.body = JSON.stringify(body);
  }
  return new NextRequest(
    new Request('http://localhost:3001/api/auth/local-login', reqInit),
  );
}

interface ResponseLike {
  status: number;
  body: unknown;
  cookies: Record<string, string>;
  rawCookies: string[];
  contentType: string | null;
}

async function readResponse(res: Response): Promise<ResponseLike> {
  const cookies: Record<string, string> = {};
  // NextResponse exposes cookies via headers.getSetCookie()
  const setCookies =
    (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    const first = raw.split(';', 1)[0] ?? '';
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    cookies[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
  let body: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return {
    status: res.status,
    body,
    cookies,
    rawCookies: setCookies,
    contentType: res.headers.get('content-type'),
  };
}

describe('POST /api/auth/local-login', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch not stubbed for this test');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 RFC 7807 when the body is not valid JSON', async () => {
    const req = makeRequest(undefined, { raw: 'not json' });
    const res = await POST(req);
    const out = await readResponse(res);
    expect(out.status).toBe(400);
    expect(out.contentType).toContain('application/problem+json');
    expect((out.body as { title: string }).title).toMatch(/Invalid JSON/i);
  });

  it('returns 400 when email is missing', async () => {
    const req = makeRequest({ password: 'secret' });
    const res = await POST(req);
    const out = await readResponse(res);
    expect(out.status).toBe(400);
    expect(out.contentType).toContain('application/problem+json');
    expect((out.body as { title: string }).title).toMatch(/email and password/i);
  });

  it('returns 400 when password is missing', async () => {
    const req = makeRequest({ email: 'a@b.c' });
    const res = await POST(req);
    const out = await readResponse(res);
    expect(out.status).toBe(400);
  });

  it('returns 400 when email is not a string', async () => {
    const req = makeRequest({ email: 123, password: 'secret' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('sets sa_session from upstream idToken on success (NOT accessToken)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          idToken: 'id-token-value',
          accessToken: 'access-token-value',
          refreshToken: 'refresh-token-value',
          expiresIn: 900,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const req = makeRequest({ email: 'a@b.c', password: 'secret' });
    const res = await POST(req);
    const out = await readResponse(res);

    expect(out.status).toBe(200);
    expect(out.cookies.sa_session).toBe('id-token-value');
    expect(out.cookies.sa_session).not.toBe('access-token-value');
    expect(out.cookies.sa_refresh).toBe('refresh-token-value');
  });

  it('falls back to accessToken when upstream omits idToken', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ accessToken: 'access-only', refreshToken: 'r' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const req = makeRequest({ email: 'a@b.c', password: 'secret' });
    const res = await POST(req);
    const out = await readResponse(res);
    expect(out.status).toBe(200);
    expect(out.cookies.sa_session).toBe('access-only');
  });

  it('accepts snake_case token field names from upstream', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id_token: 'snake-id',
          refresh_token: 'snake-refresh',
          expires_in: 600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const req = makeRequest({ email: 'a@b.c', password: 'p' });
    const out = await readResponse(await POST(req));
    expect(out.cookies.sa_session).toBe('snake-id');
    expect(out.cookies.sa_refresh).toBe('snake-refresh');
  });

  it('forwards upstream 401 status and body verbatim', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ title: 'Invalid credentials', status: 401 }),
        {
          status: 401,
          headers: { 'content-type': 'application/problem+json' },
        },
      ),
    );

    const req = makeRequest({ email: 'a@b.c', password: 'wrong' });
    const res = await POST(req);
    const out = await readResponse(res);
    expect(out.status).toBe(401);
    expect((out.body as { title: string }).title).toBe('Invalid credentials');
    expect(out.cookies.sa_session).toBeUndefined();
  });

  it('returns 502 RFC 7807 when fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const req = makeRequest({ email: 'a@b.c', password: 'p' });
    const res = await POST(req);
    const out = await readResponse(res);
    expect(out.status).toBe(502);
    expect(out.contentType).toContain('application/problem+json');
    expect((out.body as { detail: string }).detail).toBe('ECONNREFUSED');
  });

  it('mirrors upstream Set-Cookie `session` to sa_session', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append(
      'set-cookie',
      'session=upstream-session-token; HttpOnly; Path=/',
    );
    headers.append(
      'set-cookie',
      'refresh=upstream-refresh-token; HttpOnly; Path=/',
    );

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 200, headers }),
    );

    const req = makeRequest({ email: 'a@b.c', password: 'p' });
    const out = await readResponse(await POST(req));
    expect(out.status).toBe(200);
    expect(out.cookies.sa_session).toBe('upstream-session-token');
    expect(out.cookies.sa_refresh).toBe('upstream-refresh-token');
  });

  it('preserves x-trace-id from request header in response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ idToken: 't' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const req = makeRequest(
      { email: 'a@b.c', password: 'p' },
      { headers: { 'x-trace-id': 'trace-123' } },
    );
    const res = await POST(req);
    expect(res.headers.get('x-trace-id')).toBe('trace-123');
  });

  // ---- Audit M6: Origin allowlist (CSRF defence) -------------------------

  describe('Origin allowlist (audit M6)', () => {
    it('returns 403 when the Origin header is missing', async () => {
      const req = makeRequest(
        { email: 'a@b.c', password: 'p' },
        { omitOrigin: true },
      );
      const res = await POST(req);
      const out = await readResponse(res);
      expect(out.status).toBe(403);
      expect((out.body as { error: string }).error).toBe('Origin not allowed');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('returns 403 for a foreign Origin header', async () => {
      const req = makeRequest(
        { email: 'a@b.c', password: 'p' },
        { headers: { origin: 'http://malicious.example' } },
      );
      const res = await POST(req);
      const out = await readResponse(res);
      expect(out.status).toBe(403);
      expect((out.body as { error: string }).error).toBe('Origin not allowed');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('proceeds normally when Origin matches the dev allowlist', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ idToken: 't' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const req = makeRequest(
        { email: 'a@b.c', password: 'p' },
        { headers: { origin: 'http://localhost:3001' } },
      );
      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  // ---- Audit M6 + L3: cookie hardening ----------------------------------

  describe('cookie hardening (audit M6 + L3)', () => {
    it('emits sa_session/sa_refresh with SameSite=Strict + HttpOnly', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            idToken: 'id',
            refreshToken: 'rt',
            expiresIn: 900,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const req = makeRequest({ email: 'a@b.c', password: 'p' });
      const out = await readResponse(await POST(req));
      expect(out.status).toBe(200);

      const sessionCookie = out.rawCookies.find((c) => c.startsWith('sa_session='));
      const refreshCookie = out.rawCookies.find((c) => c.startsWith('sa_refresh='));
      expect(sessionCookie).toBeDefined();
      expect(refreshCookie).toBeDefined();

      // Strict — not Lax — closes the top-level POST CSRF gap.
      expect(sessionCookie).toMatch(/SameSite=strict/i);
      expect(refreshCookie).toMatch(/SameSite=strict/i);
      expect(sessionCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(sessionCookie).toMatch(/Path=\//);
    });

    it('omits the Secure flag in development NODE_ENV', async () => {
      // NODE_ENV is readonly under @types/node 20.6+; use vi.stubEnv to mutate.
      vi.stubEnv('NODE_ENV', 'development');
      try {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(JSON.stringify({ idToken: 'id' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
        const req = makeRequest({ email: 'a@b.c', password: 'p' });
        const out = await readResponse(await POST(req));
        const sessionCookie = out.rawCookies.find((c) =>
          c.startsWith('sa_session='),
        );
        expect(sessionCookie).toBeDefined();
        expect(sessionCookie).not.toMatch(/;\s*Secure/i);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
