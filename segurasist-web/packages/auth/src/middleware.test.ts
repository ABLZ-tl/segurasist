import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { protectMiddleware } from './middleware';
import { REFRESH_COOKIE, SESSION_COOKIE } from './config';

vi.mock('./cognito', () => ({
  verifyAccessToken: vi.fn(),
  refreshTokens: vi.fn(),
}));

import { verifyAccessToken, refreshTokens } from './cognito';

const mockVerify = verifyAccessToken as unknown as ReturnType<typeof vi.fn>;
const mockRefresh = refreshTokens as unknown as ReturnType<typeof vi.fn>;

function buildReq(
  path: string,
  cookies: Record<string, string> = {},
  origin = 'https://admin.example.com',
): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(`${origin}${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

beforeEach(() => {
  mockVerify.mockReset();
  mockRefresh.mockReset();
});

describe('protectMiddleware()', () => {
  it.each([
    '/login',
    '/login/saml',
    '/callback',
    '/api/auth/callback',
    '/_next/static/foo',
    '/favicon.ico',
    '/static/img.png',
    '/public/about',
  ])('lets public path %s through without verifying', async (path) => {
    const req = buildReq(path);
    const res = await protectMiddleware(req);
    expect(res.status).toBe(200);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('lets request pass when access token verifies successfully', async () => {
    mockVerify.mockResolvedValueOnce({ payload: { sub: 'u1' } });
    const req = buildReq('/dashboard', { [SESSION_COOKIE]: 'good-jwt' });
    const res = await protectMiddleware(req);
    expect(mockVerify).toHaveBeenCalledWith('good-jwt');
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('falls back to refresh when access token verify throws', async () => {
    mockVerify.mockRejectedValueOnce(new Error('expired'));
    mockRefresh.mockResolvedValueOnce({
      access_token: 'new-at',
      id_token: 'new-id',
      refresh_token: 'new-rt',
      expires_in: 600,
      token_type: 'Bearer',
    });
    const req = buildReq('/dashboard', {
      [SESSION_COOKIE]: 'expired-jwt',
      [REFRESH_COOKIE]: 'rt',
    });
    const res = await protectMiddleware(req);
    expect(mockRefresh).toHaveBeenCalledWith('rt');
    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const sessionCookie = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=new-at`));
    expect(sessionCookie).toBeDefined();
    // C-11 regression test: silent refresh must emit SameSite=Strict — the
    // legacy code emitted Lax on every refresh, leaving a CSRF gap.
    expect(sessionCookie).toMatch(/SameSite=Strict/i);
  });

  it('redirects to /login when no cookies are present', async () => {
    const req = buildReq('/dashboard');
    const res = await protectMiddleware(req);
    expect(res.status).toBe(307);
    const loc = res.headers.get('location');
    expect(loc).not.toBeNull();
    const url = new URL(loc!);
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next')).toBe('/dashboard');
  });

  it('redirects to /login and clears cookies when refresh also fails', async () => {
    mockVerify.mockRejectedValueOnce(new Error('expired'));
    mockRefresh.mockRejectedValueOnce(new Error('refresh failed'));
    const req = buildReq('/dashboard', {
      [SESSION_COOKIE]: 'expired',
      [REFRESH_COOKIE]: 'bad-rt',
    });
    const res = await protectMiddleware(req);
    expect(res.status).toBe(307);
    const loc = res.headers.get('location');
    expect(new URL(loc!).pathname).toBe('/login');
    const setCookies = res.headers.getSetCookie?.() ?? [];
    expect(
      setCookies.some(
        (c) =>
          c.startsWith(`${SESSION_COOKIE}=`) &&
          /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c),
      ),
    ).toBe(true);
  });

  it('honors a custom loginPath', async () => {
    const req = buildReq('/dashboard');
    const res = await protectMiddleware(req, { loginPath: '/custom-login' });
    expect(new URL(res.headers.get('location')!).pathname).toBe('/custom-login');
  });

  it('honors custom publicPathPatterns and bypasses verification', async () => {
    const req = buildReq('/whitelisted/path');
    const res = await protectMiddleware(req, {
      publicPathPatterns: ['^/whitelisted'],
    });
    expect(res.status).toBe(200);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('attempts refresh when the session cookie is missing but a refresh cookie exists', async () => {
    mockRefresh.mockResolvedValueOnce({
      access_token: 'fresh',
      id_token: 'i',
      expires_in: 600,
      token_type: 'Bearer',
    });
    const req = buildReq('/dashboard', { [REFRESH_COOKIE]: 'rt' });
    const res = await protectMiddleware(req);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledWith('rt');
    expect(res.status).toBe(200);
  });

  it('preserves the original path in the next= search param when redirecting', async () => {
    const req = buildReq('/secret/page');
    const res = await protectMiddleware(req);
    const url = new URL(res.headers.get('location')!);
    expect(url.searchParams.get('next')).toBe('/secret/page');
  });
});
