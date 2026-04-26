import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../../app/api/auth/me/route';

function makeRequest(opts: { cookie?: string; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie !== undefined) {
    headers.cookie = `sa_session=${opts.cookie}`;
  }
  return new NextRequest(
    new Request('http://localhost:3001/api/auth/me', { method: 'GET', headers }),
  );
}

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch not stubbed for this test');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 RFC 7807 when no session cookie is present', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const body = (await res.json()) as { title: string; status: number };
    expect(body.status).toBe(401);
    expect(body.title).toMatch(/no session/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('forwards upstream 200 body verbatim', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'u1', email: 'a@b.c', role: 'operator' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const res = await GET(makeRequest({ cookie: 'token-123' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 'u1', email: 'a@b.c', role: 'operator' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer token-123');
    expect(headers.cookie).toBe('session=token-123');
  });

  it('forwards upstream 401 status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"title":"forbidden"}', {
        status: 401,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
    const res = await GET(makeRequest({ cookie: 'expired' }));
    expect(res.status).toBe(401);
  });

  it('returns 502 when upstream fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('boom'));
    const res = await GET(makeRequest({ cookie: 'tok' }));
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe('boom');
  });

  it('preserves x-trace-id when supplied by the caller', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const res = await GET(
      makeRequest({ cookie: 'tok', headers: { 'x-trace-id': 'abc-1' } }),
    );
    expect(res.headers.get('x-trace-id')).toBe('abc-1');
  });
});
