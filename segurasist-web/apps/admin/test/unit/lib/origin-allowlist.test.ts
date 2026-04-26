import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkOrigin } from '../../../lib/origin-allowlist';

describe('lib/origin-allowlist — checkOrigin()', () => {
  const originalAdminOrigin = process.env['NEXT_PUBLIC_ADMIN_ORIGIN'];

  beforeEach(() => {
    delete process.env['NEXT_PUBLIC_ADMIN_ORIGIN'];
  });

  afterEach(() => {
    if (originalAdminOrigin === undefined)
      delete process.env['NEXT_PUBLIC_ADMIN_ORIGIN'];
    else process.env['NEXT_PUBLIC_ADMIN_ORIGIN'] = originalAdminOrigin;
  });

  describe('non-mutating methods are never blocked', () => {
    it.each(['GET', 'HEAD', 'OPTIONS'])(
      'allows %s with no Origin header',
      (method) => {
        const result = checkOrigin({ method, pathname: '/api/users', origin: null });
        expect(result.reject).toBe(false);
      },
    );

    it('allows GET even when Origin is hostile', () => {
      const result = checkOrigin({
        method: 'GET',
        pathname: '/api/users',
        origin: 'http://evil.example',
      });
      expect(result.reject).toBe(false);
    });
  });

  describe('mutating methods', () => {
    it('rejects POST when Origin header is missing', () => {
      const result = checkOrigin({
        method: 'POST',
        pathname: '/api/auth/local-login',
        origin: null,
      });
      expect(result.reject).toBe(true);
      expect(result.reason).toBe('missing-origin');
    });

    it('rejects POST when Origin header is empty string', () => {
      const result = checkOrigin({
        method: 'POST',
        pathname: '/api/auth/local-login',
        origin: '',
      });
      expect(result.reject).toBe(true);
      expect(result.reason).toBe('missing-origin');
    });

    it('rejects POST with a foreign Origin', () => {
      const result = checkOrigin({
        method: 'POST',
        pathname: '/api/auth/local-login',
        origin: 'http://malicious.example',
      });
      expect(result.reject).toBe(true);
      expect(result.reason).toBe('origin-not-allowed');
    });

    it('allows POST from http://localhost:3001 (dev admin)', () => {
      const result = checkOrigin({
        method: 'POST',
        pathname: '/api/auth/local-login',
        origin: 'http://localhost:3001',
      });
      expect(result.reject).toBe(false);
    });

    it('allows POST from NEXT_PUBLIC_ADMIN_ORIGIN when configured', () => {
      process.env['NEXT_PUBLIC_ADMIN_ORIGIN'] = 'https://admin.segurasist.app';
      const result = checkOrigin({
        method: 'POST',
        pathname: '/api/auth/local-login',
        origin: 'https://admin.segurasist.app',
      });
      expect(result.reject).toBe(false);
    });

    it('rejects prod-host-looking Origin if NEXT_PUBLIC_ADMIN_ORIGIN unset', () => {
      // No env override → only the dev port is allowed.
      const result = checkOrigin({
        method: 'POST',
        pathname: '/api/users',
        origin: 'https://admin.segurasist.app',
      });
      expect(result.reject).toBe(true);
      expect(result.reason).toBe('origin-not-allowed');
    });

    it.each(['PUT', 'PATCH', 'DELETE', 'post', 'put'])(
      '%s is treated as state-changing (case-insensitive)',
      (method) => {
        const result = checkOrigin({
          method,
          pathname: '/api/something',
          origin: null,
        });
        expect(result.reject).toBe(true);
      },
    );
  });

  describe('webhook exemption', () => {
    it('allows POST /api/webhooks/* with no Origin header', () => {
      const result = checkOrigin({
        method: 'POST',
        pathname: '/api/webhooks/cognito',
        origin: null,
      });
      expect(result.reject).toBe(false);
    });

    it('allows POST /api/webhooks/* with foreign Origin', () => {
      const result = checkOrigin({
        method: 'POST',
        pathname: '/api/webhooks/ses',
        origin: 'http://amazonses.example',
      });
      expect(result.reject).toBe(false);
    });

    it('does NOT exempt non-webhook paths that contain "webhooks" as a substring', () => {
      const result = checkOrigin({
        method: 'POST',
        pathname: '/api/internal-webhooks/foo',
        origin: null,
      });
      expect(result.reject).toBe(true);
    });
  });
});
