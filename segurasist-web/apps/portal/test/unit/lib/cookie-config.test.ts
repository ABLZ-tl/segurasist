import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `isSecureContext()` reads `process.env.NODE_ENV` at call time. Node 20.6+
 * marks NODE_ENV as readonly in @types/node, so we use Vitest's `stubEnv`
 * helper to mutate it safely (it bypasses the type, restores on
 * `unstubAllEnvs`).
 */
async function loadModule(): Promise<typeof import('../../../lib/cookie-config')> {
  return import('../../../lib/cookie-config');
}

describe('lib/cookie-config — isSecureContext()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns true when NODE_ENV is exactly "production"', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { isSecureContext } = await loadModule();
    expect(isSecureContext()).toBe(true);
  });

  it('returns true when NODE_ENV is exactly "staging"', async () => {
    vi.stubEnv('NODE_ENV', 'staging');
    const { isSecureContext } = await loadModule();
    expect(isSecureContext()).toBe(true);
  });

  it('returns false when NODE_ENV is "development"', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { isSecureContext } = await loadModule();
    expect(isSecureContext()).toBe(false);
  });

  it('returns false when NODE_ENV is "test"', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { isSecureContext } = await loadModule();
    expect(isSecureContext()).toBe(false);
  });

  it('rejects "prod" typo (config drift defence)', async () => {
    vi.stubEnv('NODE_ENV', 'prod');
    const { isSecureContext } = await loadModule();
    expect(isSecureContext()).toBe(false);
  });

  it('rejects "production-staging" combo (config drift defence)', async () => {
    vi.stubEnv('NODE_ENV', 'production-staging');
    const { isSecureContext } = await loadModule();
    expect(isSecureContext()).toBe(false);
  });

  it('returns false when NODE_ENV is unset', async () => {
    vi.stubEnv('NODE_ENV', '');
    const { isSecureContext } = await loadModule();
    expect(isSecureContext()).toBe(false);
  });

  it('rejects whitespace-padded values (no implicit trim)', async () => {
    vi.stubEnv('NODE_ENV', ' production ');
    const { isSecureContext } = await loadModule();
    expect(isSecureContext()).toBe(false);
  });
});

describe('lib/cookie-config — buildSessionCookie()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a hardened cookie payload with sameSite=strict + httpOnly', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { buildSessionCookie } = await loadModule();
    const cookie = buildSessionCookie('sa_session_portal', 'abc.def.ghi', { maxAge: 900 });

    expect(cookie).toEqual({
      name: 'sa_session_portal',
      value: 'abc.def.ghi',
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/',
      maxAge: 900,
    });
  });

  it('flips secure=true under production NODE_ENV', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { buildSessionCookie } = await loadModule();
    const cookie = buildSessionCookie('sa_refresh_portal', 'rt-value', {
      maxAge: 60 * 60 * 24 * 7,
    });
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe('strict');
    expect(cookie.maxAge).toBe(60 * 60 * 24 * 7);
  });

  it('keeps secure=false for non-allowlisted env (e.g. "prod" typo)', async () => {
    vi.stubEnv('NODE_ENV', 'prod');
    const { buildSessionCookie } = await loadModule();
    const cookie = buildSessionCookie('sa_session_portal', 'v', { maxAge: 60 });
    expect(cookie.secure).toBe(false);
  });

  it('passes through arbitrary cookie names and values', async () => {
    vi.stubEnv('NODE_ENV', 'staging');
    const { buildSessionCookie } = await loadModule();
    const cookie = buildSessionCookie('arbitrary', 'value-with.special_chars', {
      maxAge: 1,
    });
    expect(cookie.name).toBe('arbitrary');
    expect(cookie.value).toBe('value-with.special_chars');
    expect(cookie.secure).toBe(true);
  });
});
