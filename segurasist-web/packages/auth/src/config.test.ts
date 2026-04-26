import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getAuthEnv,
  PKCE_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  STATE_COOKIE,
} from './config';

const REQUIRED_KEYS = [
  'COGNITO_REGION',
  'COGNITO_USER_POOL_ID',
  'COGNITO_CLIENT_ID',
  'COGNITO_DOMAIN',
  'COGNITO_REDIRECT_URI',
] as const;

const OPTIONAL_KEYS = [
  'COGNITO_CLIENT_SECRET',
  'COGNITO_LOGOUT_URI',
  'COGNITO_SCOPE',
] as const;

const SAMPLE: Record<(typeof REQUIRED_KEYS)[number], string> = {
  COGNITO_REGION: 'mx-central-1',
  COGNITO_USER_POOL_ID: 'mx-central-1_AbC123',
  COGNITO_CLIENT_ID: 'client-abc',
  COGNITO_DOMAIN: 'https://segurasist.auth.mx-central-1.amazoncognito.com',
  COGNITO_REDIRECT_URI: 'https://admin.segurasist.app/api/auth/callback',
};

const ALL_KEYS = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];

let original: Record<string, string | undefined> = {};

beforeEach(() => {
  original = {};
  for (const k of ALL_KEYS) {
    original[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(SAMPLE)) {
    process.env[k] = v;
  }
});

afterEach(() => {
  for (const k of ALL_KEYS) {
    if (original[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = original[k];
    }
  }
});

describe('cookie name constants', () => {
  it('has stable cookie names so deployed sessions do not break', () => {
    expect(SESSION_COOKIE).toBe('sa_session');
    expect(REFRESH_COOKIE).toBe('sa_refresh');
    expect(PKCE_COOKIE).toBe('sa_pkce');
    expect(STATE_COOKIE).toBe('sa_state');
  });
});

describe('getAuthEnv()', () => {
  it('returns the typed object when all required vars are present', () => {
    const env = getAuthEnv();
    expect(env).toMatchObject({
      region: SAMPLE.COGNITO_REGION,
      userPoolId: SAMPLE.COGNITO_USER_POOL_ID,
      clientId: SAMPLE.COGNITO_CLIENT_ID,
      domain: SAMPLE.COGNITO_DOMAIN,
      redirectUri: SAMPLE.COGNITO_REDIRECT_URI,
    });
  });

  it('omits clientSecret when COGNITO_CLIENT_SECRET is unset', () => {
    const env = getAuthEnv();
    expect('clientSecret' in env).toBe(false);
  });

  it('includes clientSecret when COGNITO_CLIENT_SECRET is set', () => {
    process.env['COGNITO_CLIENT_SECRET'] = 's3cret';
    expect(getAuthEnv().clientSecret).toBe('s3cret');
  });

  it('falls back logoutUri to redirectUri when not set', () => {
    expect(getAuthEnv().logoutUri).toBe(SAMPLE.COGNITO_REDIRECT_URI);
  });

  it('uses COGNITO_LOGOUT_URI when set', () => {
    process.env['COGNITO_LOGOUT_URI'] = 'https://example.com/bye';
    expect(getAuthEnv().logoutUri).toBe('https://example.com/bye');
  });

  it('defaults scope to "openid email profile" when not set', () => {
    expect(getAuthEnv().scope).toBe('openid email profile');
  });

  it('uses COGNITO_SCOPE when set', () => {
    process.env['COGNITO_SCOPE'] = 'openid email';
    expect(getAuthEnv().scope).toBe('openid email');
  });

  it.each(REQUIRED_KEYS)('throws when required env var %s is missing', (key) => {
    delete process.env[key];
    expect(() => getAuthEnv()).toThrow(new RegExp(`Missing required env var: ${key}`));
  });

  it('throws when required env var is empty string (treated as missing)', () => {
    process.env['COGNITO_REGION'] = '';
    expect(() => getAuthEnv()).toThrow(/Missing required env var: COGNITO_REGION/);
  });
});
