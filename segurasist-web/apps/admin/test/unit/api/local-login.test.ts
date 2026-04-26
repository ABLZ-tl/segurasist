import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../../app/api/auth/local-login/route';

function makeRequest(
  body: unknown,
  init: { headers?: Record<string, string>; raw?: string } = {},
): NextRequest {
  const reqInit: RequestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
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
});
