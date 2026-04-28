import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeProxyHandler } from '../src/proxy';

const COOKIE = 'sa_session_portal';
const ALLOW = ['https://portal.segurasist.app'];
const API = 'https://api.segurasist.app';

function buildReq(
  init: {
    method?: string;
    origin?: string | null;
    cookies?: Record<string, string>;
    path?: string;
    query?: string;
    body?: string;
    extraHeaders?: Record<string, string>;
  } = {},
): NextRequest {
  const method = init.method ?? 'GET';
  const path = init.path ?? '/api/proxy/insureds';
  const url = `https://portal.segurasist.app${path}${init.query ?? ''}`;
  const headers: Record<string, string> = {};
  if (init.origin !== null && init.origin !== undefined) headers['origin'] = init.origin;
  if (init.cookies) {
    headers['cookie'] = Object.entries(init.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.extraHeaders) Object.assign(headers, init.extraHeaders);
  const reqInit: RequestInit = { method, headers };
  if (init.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    reqInit.body = init.body;
  }
  return new NextRequest(url, reqInit as ConstructorParameters<typeof NextRequest>[1]);
}

describe('makeProxyHandler()', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 403 when Origin is present but not in the allowlist', async () => {
    const handler = makeProxyHandler({
      cookieName: COOKIE,
      originAllowlist: ALLOW,
      apiBase: API,
    });
    const res = await handler(
      buildReq({
        method: 'POST',
        origin: 'https://evil.example.com',
        cookies: { [COOKIE]: 'tok' },
        body: '{}',
      }),
      { params: { path: ['insureds'] } },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'origin-rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 when Origin is OK but session cookie is missing', async () => {
    const handler = makeProxyHandler({
      cookieName: COOKIE,
      originAllowlist: ALLOW,
      apiBase: API,
    });
    const res = await handler(
      buildReq({ method: 'GET', origin: ALLOW[0]! }),
      { params: { path: ['insureds'] } },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards GET with Bearer to the backend and copies query string', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const handler = makeProxyHandler({
      cookieName: COOKIE,
      originAllowlist: ALLOW,
      apiBase: API,
    });
    const res = await handler(
      buildReq({
        method: 'GET',
        origin: ALLOW[0]!,
        cookies: { [COOKIE]: 'tok-abc' },
        path: '/api/proxy/insureds',
        query: '?page=2&limit=50',
      }),
      { params: { path: ['insureds'] } },
    );
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect((url as URL).toString()).toBe(`${API}/insureds?page=2&limit=50`);
    expect((init as RequestInit).method).toBe('GET');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('authorization')).toBe('Bearer tok-abc');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('forwards POST body to the backend', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"id":1}', { status: 201, headers: { 'content-type': 'application/json' } }),
    );
    const handler = makeProxyHandler({
      cookieName: COOKIE,
      originAllowlist: ALLOW,
      apiBase: API,
    });
    const res = await handler(
      buildReq({
        method: 'POST',
        origin: ALLOW[0]!,
        cookies: { [COOKIE]: 'tok' },
        body: '{"name":"x"}',
      }),
      { params: { path: ['insureds'] } },
    );
    expect(res.status).toBe(201);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeDefined();
  });

  it('does NOT forward the cookie header to the upstream API', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const handler = makeProxyHandler({
      cookieName: COOKIE,
      originAllowlist: ALLOW,
      apiBase: API,
    });
    await handler(
      buildReq({ method: 'GET', origin: ALLOW[0]!, cookies: { [COOKIE]: 'tok' } }),
      { params: { path: ['x'] } },
    );
    const headers = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.get('cookie')).toBeNull();
  });

  it('forwards x-trace-id when present', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const handler = makeProxyHandler({
      cookieName: COOKIE,
      originAllowlist: ALLOW,
      apiBase: API,
    });
    await handler(
      buildReq({
        method: 'GET',
        origin: ALLOW[0]!,
        cookies: { [COOKIE]: 'tok' },
        extraHeaders: { 'x-trace-id': 'trace-42' },
      }),
      { params: { path: ['x'] } },
    );
    const headers = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.get('x-trace-id')).toBe('trace-42');
  });

  it('drops hop-by-hop response headers (transfer-encoding, connection)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('hi', {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'transfer-encoding': 'chunked',
          connection: 'keep-alive',
          'x-custom': 'kept',
        },
      }),
    );
    const handler = makeProxyHandler({
      cookieName: COOKIE,
      originAllowlist: ALLOW,
      apiBase: API,
    });
    const res = await handler(
      buildReq({ method: 'GET', origin: ALLOW[0]!, cookies: { [COOKIE]: 'tok' } }),
      { params: { path: ['x'] } },
    );
    expect(res.headers.get('transfer-encoding')).toBeNull();
    expect(res.headers.get('connection')).toBeNull();
    expect(res.headers.get('x-custom')).toBe('kept');
  });

  it('treats empty Origin header as allowed (server-to-server)', async () => {
    // Per checkOrigin() contract: missing Origin is allowed; the advanced
    // gate (with reject-on-missing) lives in the per-app middleware. The
    // proxy factory is defense-in-depth, not the only Origin gate.
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const handler = makeProxyHandler({
      cookieName: COOKIE,
      originAllowlist: ALLOW,
      apiBase: API,
    });
    const res = await handler(
      buildReq({ method: 'GET', origin: null, cookies: { [COOKIE]: 'tok' } }),
      { params: { path: ['x'] } },
    );
    expect(res.status).toBe(200);
  });

  it('returns the upstream status code unchanged (e.g. 500 propagated)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const handler = makeProxyHandler({
      cookieName: COOKIE,
      originAllowlist: ALLOW,
      apiBase: API,
    });
    const res = await handler(
      buildReq({ method: 'GET', origin: ALLOW[0]!, cookies: { [COOKIE]: 'tok' } }),
      { params: { path: ['x'] } },
    );
    expect(res.status).toBe(500);
  });
});
