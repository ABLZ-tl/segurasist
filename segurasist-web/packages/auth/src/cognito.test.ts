import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SAMPLE_ENV = {
  COGNITO_REGION: 'mx-central-1',
  COGNITO_USER_POOL_ID: 'mx-central-1_AbC123',
  COGNITO_CLIENT_ID: 'client-abc',
  COGNITO_DOMAIN: 'https://segurasist.auth.mx-central-1.amazoncognito.com',
  COGNITO_REDIRECT_URI: 'https://admin.segurasist.app/api/auth/callback',
};

const KEYS = [
  ...Object.keys(SAMPLE_ENV),
  'COGNITO_CLIENT_SECRET',
  'COGNITO_LOGOUT_URI',
  'COGNITO_SCOPE',
] as const;

let original: Record<string, string | undefined> = {};

beforeEach(() => {
  original = {};
  for (const k of KEYS) {
    original[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(SAMPLE_ENV)) {
    process.env[k] = v;
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (original[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = original[k];
    }
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildAuthorizeUrl()', () => {
  it('contains client_id, response_type, redirect_uri, scope, state, code_challenge', async () => {
    const { buildAuthorizeUrl } = await import('./cognito');
    const url = new URL(
      buildAuthorizeUrl({ state: 'st', codeChallenge: 'cc' }),
    );
    expect(url.origin + url.pathname).toBe(
      'https://segurasist.auth.mx-central-1.amazoncognito.com/oauth2/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('client-abc');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(SAMPLE_ENV.COGNITO_REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('code_challenge')).toBe('cc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('identity_provider')).toBeNull();
  });

  it('appends identity_provider when supplied', async () => {
    const { buildAuthorizeUrl } = await import('./cognito');
    const url = new URL(
      buildAuthorizeUrl({ state: 's', codeChallenge: 'c', identityProvider: 'MAC-SAML' }),
    );
    expect(url.searchParams.get('identity_provider')).toBe('MAC-SAML');
  });
});

describe('buildLogoutUrl()', () => {
  it('uses logout_uri = redirect_uri by default', async () => {
    const { buildLogoutUrl } = await import('./cognito');
    const url = new URL(buildLogoutUrl());
    expect(url.searchParams.get('client_id')).toBe('client-abc');
    expect(url.searchParams.get('logout_uri')).toBe(SAMPLE_ENV.COGNITO_REDIRECT_URI);
  });

  it('uses COGNITO_LOGOUT_URI when set', async () => {
    process.env['COGNITO_LOGOUT_URI'] = 'https://example.com/bye';
    const { buildLogoutUrl } = await import('./cognito');
    const url = new URL(buildLogoutUrl());
    expect(url.searchParams.get('logout_uri')).toBe('https://example.com/bye');
  });
});

describe('exchangeCodeForTokens()', () => {
  it('POSTs to /oauth2/token with grant_type=authorization_code and parses tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'at',
          id_token: 'id',
          refresh_token: 'rt',
          expires_in: 600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { exchangeCodeForTokens } = await import('./cognito');
    const tokens = await exchangeCodeForTokens('the-code', 'verifier-xyz');
    expect(tokens.access_token).toBe('at');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://segurasist.auth.mx-central-1.amazoncognito.com/oauth2/token',
    );
    expect(init.method).toBe('POST');
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('verifier-xyz');
    expect(body.get('client_id')).toBe('client-abc');
  });

  it('attaches Basic auth header when CLIENT_SECRET is set', async () => {
    process.env['COGNITO_CLIENT_SECRET'] = 'shh';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'at',
          id_token: 'id',
          expires_in: 600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { exchangeCodeForTokens } = await import('./cognito');
    await exchangeCodeForTokens('c', 'v');
    const init = fetchMock.mock.calls[0]![1];
    const expected = `Basic ${Buffer.from('client-abc:shh').toString('base64')}`;
    expect(init.headers.authorization).toBe(expected);
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('boom', { status: 400 })),
    );
    const { exchangeCodeForTokens } = await import('./cognito');
    await expect(exchangeCodeForTokens('c', 'v')).rejects.toThrow(
      /Cognito token exchange failed: 400/,
    );
  });
});

describe('refreshTokens()', () => {
  it('POSTs grant_type=refresh_token and returns parsed tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'new-at',
          id_token: 'id',
          expires_in: 600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { refreshTokens } = await import('./cognito');
    const t = await refreshTokens('rt');
    expect(t.access_token).toBe('new-at');
    const body = fetchMock.mock.calls[0]![1].body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt');
    expect(body.get('client_id')).toBe('client-abc');
  });

  it('throws when Cognito returns non-OK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 401 })),
    );
    const { refreshTokens } = await import('./cognito');
    await expect(refreshTokens('rt')).rejects.toThrow(/Cognito refresh failed: 401/);
  });

  it('attaches Basic auth header when CLIENT_SECRET is set', async () => {
    process.env['COGNITO_CLIENT_SECRET'] = 'shh';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'at',
          id_token: 'id',
          expires_in: 600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { refreshTokens } = await import('./cognito');
    await refreshTokens('rt');
    const expected = `Basic ${Buffer.from('client-abc:shh').toString('base64')}`;
    expect(fetchMock.mock.calls[0]![1].headers.authorization).toBe(expected);
  });
});

describe('verifyAccessToken()', () => {
  it('rejects when client_id claim does not match env', async () => {
    vi.doMock('jose', () => ({
      createRemoteJWKSet: vi.fn(() => 'jwks-mock'),
      jwtVerify: vi.fn().mockResolvedValue({
        payload: { sub: 'u1', client_id: 'OTHER-client' },
      }),
    }));
    vi.resetModules();
    const { verifyAccessToken } = await import('./cognito');
    await expect(verifyAccessToken('token')).rejects.toThrow(
      /Invalid token client_id/,
    );
    vi.doUnmock('jose');
  });

  it('returns the payload when client_id matches', async () => {
    vi.doMock('jose', () => ({
      createRemoteJWKSet: vi.fn(() => 'jwks-mock'),
      jwtVerify: vi.fn().mockResolvedValue({
        payload: { sub: 'u1', client_id: 'client-abc' },
      }),
    }));
    vi.resetModules();
    const { verifyAccessToken } = await import('./cognito');
    const v = await verifyAccessToken('token');
    expect(v.payload.sub).toBe('u1');
    vi.doUnmock('jose');
  });

  it('returns the payload when no client_id claim is present (id token)', async () => {
    vi.doMock('jose', () => ({
      createRemoteJWKSet: vi.fn(() => 'jwks-mock'),
      jwtVerify: vi.fn().mockResolvedValue({
        payload: { sub: 'u1', aud: 'client-abc' },
      }),
    }));
    vi.resetModules();
    const { verifyAccessToken } = await import('./cognito');
    const v = await verifyAccessToken('token');
    expect(v.payload.sub).toBe('u1');
    vi.doUnmock('jose');
  });

  it('propagates errors from jwtVerify (signature/JWKS failures)', async () => {
    vi.doMock('jose', () => ({
      createRemoteJWKSet: vi.fn(() => 'jwks-mock'),
      jwtVerify: vi.fn().mockRejectedValue(new Error('JWKSNoMatchingKey')),
    }));
    vi.resetModules();
    const { verifyAccessToken } = await import('./cognito');
    await expect(verifyAccessToken('token')).rejects.toThrow(/JWKSNoMatchingKey/);
    vi.doUnmock('jose');
  });
});

describe('generatePkcePair()', () => {
  it('produces a base64url-encoded verifier and a SHA-256 challenge of expected length', async () => {
    const { generatePkcePair } = await import('./cognito');
    const { verifier, challenge } = await generatePkcePair();
    // base64url charset, no padding
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes -> ~43 chars; SHA-256 digest -> ~43 chars
    expect(verifier.length).toBeGreaterThanOrEqual(42);
    expect(challenge.length).toBeGreaterThanOrEqual(42);
    expect(verifier).not.toBe(challenge);
  });

  it('produces different verifiers across calls', async () => {
    const { generatePkcePair } = await import('./cognito');
    const a = await generatePkcePair();
    const b = await generatePkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});
