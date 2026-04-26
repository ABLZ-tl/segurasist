import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMe } from '../../../lib/auth-server';
import { setSessionCookie } from '../../helpers/cookies';

const SESSION = 'sa_session';

describe('fetchMe', () => {
  beforeEach(() => {
    setSessionCookie(SESSION, undefined);
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch not stubbed for this test');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns nulls when there is no session cookie', async () => {
    const me = await fetchMe();
    expect(me).toEqual({ email: null, role: null, tenantId: null });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns a fully populated Me on a 200 response', async () => {
    setSessionCookie(SESSION, 'token-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          email: 'op@hospitalesmac.com',
          role: 'operator',
          tenant: { id: 'tnt_42' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const me = await fetchMe();
    expect(me).toEqual({
      email: 'op@hospitalesmac.com',
      role: 'operator',
      tenantId: 'tnt_42',
    });
  });

  it('forwards the session cookie as Bearer + Cookie header', async () => {
    setSessionCookie(SESSION, 'token-xyz');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ email: 'a@b.c', role: 'admin_mac' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await fetchMe();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer token-xyz');
    expect(headers.cookie).toBe('session=token-xyz');
  });

  it('returns nulls on upstream 401', async () => {
    setSessionCookie(SESSION, 'token-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"title":"unauthorized"}', { status: 401 }),
    );
    const me = await fetchMe();
    expect(me).toEqual({ email: null, role: null, tenantId: null });
  });

  it('returns nulls on upstream 500', async () => {
    setSessionCookie(SESSION, 'token-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 500 }),
    );
    const me = await fetchMe();
    expect(me).toEqual({ email: null, role: null, tenantId: null });
  });

  it('returns nulls on network error (does not throw)', async () => {
    setSessionCookie(SESSION, 'token-1');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(fetchMe()).resolves.toEqual({
      email: null,
      role: null,
      tenantId: null,
    });
  });

  it('coerces a non-string role to null', async () => {
    setSessionCookie(SESSION, 'token-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ email: 'a@b.c', role: 99, tenant: { id: 't' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const me = await fetchMe();
    expect(me).toEqual({ email: 'a@b.c', role: null, tenantId: 't' });
  });

  it('coerces a string role that is not in the Role union to null', async () => {
    setSessionCookie(SESSION, 'token-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ email: 'a@b.c', role: 'root', tenant: { id: 't' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const me = await fetchMe();
    expect(me.role).toBeNull();
    expect(me.email).toBe('a@b.c');
    expect(me.tenantId).toBe('t');
  });

  it('falls back to body.user.email/role when top-level fields are absent', async () => {
    setSessionCookie(SESSION, 'token-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ user: { email: 'legacy@b.c', role: 'supervisor' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const me = await fetchMe();
    expect(me).toEqual({
      email: 'legacy@b.c',
      role: 'supervisor',
      tenantId: null,
    });
  });

  it('falls back to body.data.email/role when top-level + user are absent', async () => {
    setSessionCookie(SESSION, 'token-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { email: 'data@b.c', role: 'admin_segurasist' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const me = await fetchMe();
    expect(me).toEqual({
      email: 'data@b.c',
      role: 'admin_segurasist',
      tenantId: null,
    });
  });

  it('returns nulls when JSON parsing fails on a 200', async () => {
    setSessionCookie(SESSION, 'token-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const me = await fetchMe();
    expect(me).toEqual({ email: null, role: null, tenantId: null });
  });

  it('coerces a non-string tenantId to null', async () => {
    setSessionCookie(SESSION, 'token-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          email: 'a@b.c',
          role: 'operator',
          tenant: { id: 12345 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const me = await fetchMe();
    expect(me).toEqual({ email: 'a@b.c', role: 'operator', tenantId: null });
  });
});
