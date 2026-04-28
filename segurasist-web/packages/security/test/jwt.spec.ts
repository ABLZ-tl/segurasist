import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  decodeJwtPayload,
  isTokenExpired,
  readExpFromToken,
  readRoleFromToken,
} from '../src/jwt';

/**
 * Helper: build a fake JWT (header.payload.signature) where only the payload
 * matters. Mirrors `apps/admin/test/helpers/jwt.ts` but inlined to keep the
 * package self-contained.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  // base64url encode without padding so we exercise the padding pass in decode.
  const b64 = globalThis
    .btoa(json)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${b64}.sig`;
}

describe('decodeJwtPayload()', () => {
  it('decodes a well-formed JWT payload', () => {
    const token = makeJwt({ sub: 'u1', email: 'a@b.c' });
    expect(decodeJwtPayload(token)).toEqual({ sub: 'u1', email: 'a@b.c' });
  });

  it('returns null for an empty string, single segment, or empty payload', () => {
    expect(decodeJwtPayload('')).toBeNull();
    expect(decodeJwtPayload('only-one')).toBeNull();
    expect(decodeJwtPayload('header..sig')).toBeNull();
  });

  it('returns null for non-JSON, non-object, or array payloads', () => {
    // Non-JSON: payload is plain "abc" base64url-encoded.
    const nonJson = `header.${globalThis.btoa('abc').replace(/=+$/, '')}.sig`;
    expect(decodeJwtPayload(nonJson)).toBeNull();
    // Array payload — we explicitly reject non-object roots.
    const arrToken = `header.${globalThis
      .btoa(JSON.stringify([1, 2, 3]))
      .replace(/=+$/, '')}.sig`;
    expect(decodeJwtPayload(arrToken)).toBeNull();
    // Garbage base64url that JSON.parse would explode on.
    expect(decodeJwtPayload('???.???.???')).toBeNull();
  });

  it('does not throw on garbage input', () => {
    expect(() => decodeJwtPayload('???.???.???')).not.toThrow();
  });
});

describe('readRoleFromToken()', () => {
  it('reads custom:role when present', () => {
    expect(readRoleFromToken(makeJwt({ 'custom:role': 'admin_mac' }))).toBe(
      'admin_mac',
    );
  });

  it('falls back to plain role when custom:role is absent', () => {
    expect(readRoleFromToken(makeJwt({ role: 'operator' }))).toBe('operator');
  });

  it('prefers custom:role when both claims exist', () => {
    expect(
      readRoleFromToken(
        makeJwt({ 'custom:role': 'admin_mac', role: 'operator' }),
      ),
    ).toBe('admin_mac');
  });

  it('returns null for malformed tokens or non-string claims', () => {
    expect(readRoleFromToken('')).toBeNull();
    expect(readRoleFromToken(makeJwt({ sub: 'u1' }))).toBeNull();
    expect(readRoleFromToken(makeJwt({ 'custom:role': 42 }))).toBeNull();
  });
});

describe('readExpFromToken()', () => {
  it('reads numeric finite exp', () => {
    expect(readExpFromToken(makeJwt({ exp: 1_700_000_000 }))).toBe(1_700_000_000);
  });

  it('returns null when exp is missing, non-numeric, or non-finite', () => {
    expect(readExpFromToken(makeJwt({}))).toBeNull();
    expect(readExpFromToken(makeJwt({ exp: 'soon' }))).toBeNull();
    expect(readExpFromToken(makeJwt({ exp: Number.POSITIVE_INFINITY }))).toBeNull();
  });
});

describe('isTokenExpired()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats missing/malformed exp as expired (defensive default)', () => {
    expect(isTokenExpired('')).toBe(true);
    expect(isTokenExpired(makeJwt({}))).toBe(true);
  });

  it('returns false when nowSeconds < exp and true once nowSeconds >= exp', () => {
    const token = makeJwt({ exp: 1_000 });
    expect(isTokenExpired(token, { nowSeconds: 999 })).toBe(false);
    expect(isTokenExpired(token, { nowSeconds: 1_000 })).toBe(true);
    expect(isTokenExpired(token, { nowSeconds: 1_001 })).toBe(true);
  });

  it('honors skewSeconds as an early-expiry safety margin', () => {
    const token = makeJwt({ exp: 1_000 });
    // 30s before exp + 30s skew = exactly at the cliff → expired.
    expect(isTokenExpired(token, { nowSeconds: 970, skewSeconds: 30 })).toBe(true);
    // 31s before exp + 30s skew = still alive.
    expect(isTokenExpired(token, { nowSeconds: 969, skewSeconds: 30 })).toBe(false);
  });

  it('falls back to Date.now() when nowSeconds is omitted', () => {
    vi.setSystemTime(new Date(500_000));
    // exp at 600 (sec), now = 500 (sec) → not expired.
    expect(isTokenExpired(makeJwt({ exp: 600 }))).toBe(false);
    expect(isTokenExpired(makeJwt({ exp: 400 }))).toBe(true);
  });
});
