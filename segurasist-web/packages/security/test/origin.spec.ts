import { describe, it, expect } from 'vitest';
import {
  checkOrigin,
  checkOriginAdvanced,
  DEFAULT_WEBHOOK_PATH_PREFIXES,
  mergeAllowlist,
} from '../src/origin';

function reqWithOrigin(origin: string | null): Request {
  return new Request('https://app.example.com/api/x', {
    headers: origin === null ? {} : { origin },
  });
}

describe('checkOrigin() — simple primitive', () => {
  const allow = ['https://admin.segurasist.app', 'http://localhost:3001'];

  it('allows when Origin header is missing (server-to-server caller)', () => {
    expect(checkOrigin(reqWithOrigin(null), allow)).toBe(true);
  });

  it('allows when Origin matches a value in the allowlist', () => {
    expect(checkOrigin(reqWithOrigin('https://admin.segurasist.app'), allow)).toBe(true);
  });

  it('rejects when Origin is present but not in the allowlist', () => {
    expect(checkOrigin(reqWithOrigin('https://evil.example.com'), allow)).toBe(false);
  });

  it('rejects when allowlist is empty and Origin is present', () => {
    expect(checkOrigin(reqWithOrigin('https://admin.segurasist.app'), [])).toBe(false);
  });

  it('is case-sensitive (browsers always emit lowercase scheme + host)', () => {
    expect(
      checkOrigin(
        reqWithOrigin('https://Admin.SegurAsist.app'),
        ['https://admin.segurasist.app'],
      ),
    ).toBe(false);
  });
});

describe('checkOriginAdvanced()', () => {
  const baseOpts = {
    allowedOrigins: ['http://localhost:3001'],
    configuredOrigin: 'https://admin.segurasist.app',
  } as const;

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'never blocks safe method %s',
    (method) => {
      const res = checkOriginAdvanced(
        { method, pathname: '/api/anything', origin: null },
        baseOpts,
      );
      expect(res.reject).toBe(false);
    },
  );

  it('exempts default webhook prefix `/api/webhooks/...`', () => {
    const res = checkOriginAdvanced(
      { method: 'POST', pathname: '/api/webhooks/ses', origin: null },
      baseOpts,
    );
    expect(res.reject).toBe(false);
  });

  it('honors a custom webhook prefix override', () => {
    const res = checkOriginAdvanced(
      { method: 'POST', pathname: '/api/hooks/ses', origin: null },
      { ...baseOpts, webhookPathPrefixes: ['/api/hooks/'] },
    );
    expect(res.reject).toBe(false);
  });

  it('rejects state-changing requests with no Origin header', () => {
    const res = checkOriginAdvanced(
      { method: 'POST', pathname: '/api/x', origin: null },
      baseOpts,
    );
    expect(res).toEqual({ reject: true, reason: 'missing-origin' });
  });

  it('rejects state-changing requests with an empty Origin string', () => {
    const res = checkOriginAdvanced(
      { method: 'POST', pathname: '/api/x', origin: '' },
      baseOpts,
    );
    expect(res).toEqual({ reject: true, reason: 'missing-origin' });
  });

  it('rejects when Origin is present but not in merged allowlist', () => {
    const res = checkOriginAdvanced(
      { method: 'POST', pathname: '/api/x', origin: 'https://evil.example.com' },
      baseOpts,
    );
    expect(res).toEqual({ reject: true, reason: 'origin-not-allowed' });
  });

  it('accepts a state-changing request from the configured origin', () => {
    const res = checkOriginAdvanced(
      { method: 'POST', pathname: '/api/x', origin: 'https://admin.segurasist.app' },
      baseOpts,
    );
    expect(res.reject).toBe(false);
  });

  it('accepts a state-changing request from the static base allowlist', () => {
    const res = checkOriginAdvanced(
      { method: 'POST', pathname: '/api/x', origin: 'http://localhost:3001' },
      baseOpts,
    );
    expect(res.reject).toBe(false);
  });

  it('upper-cases the method so lowercase verbs still gate', () => {
    const res = checkOriginAdvanced(
      { method: 'post', pathname: '/api/x', origin: null },
      baseOpts,
    );
    expect(res).toEqual({ reject: true, reason: 'missing-origin' });
  });
});

describe('mergeAllowlist()', () => {
  it('returns the base list unchanged when configured is null', () => {
    const base = ['http://localhost:3001'];
    expect(mergeAllowlist(base, null)).toEqual(base);
  });

  it('returns the base list unchanged when configured is empty', () => {
    expect(mergeAllowlist(['http://a'], '')).toEqual(['http://a']);
  });

  it('appends configured when not already present', () => {
    expect(mergeAllowlist(['http://a'], 'http://b')).toEqual(['http://a', 'http://b']);
  });

  it('does not duplicate configured when already in base', () => {
    expect(mergeAllowlist(['http://a', 'http://b'], 'http://b')).toEqual([
      'http://a',
      'http://b',
    ]);
  });
});

describe('DEFAULT_WEBHOOK_PATH_PREFIXES', () => {
  it('exposes the canonical `/api/webhooks/` prefix', () => {
    expect(DEFAULT_WEBHOOK_PATH_PREFIXES).toEqual(['/api/webhooks/']);
  });
});
