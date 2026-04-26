import { describe, expect, it } from 'vitest';
import {
  decodeJwtPayload,
  readRoleFromToken,
} from '../../../lib/jwt';
import {
  makeArrayPayloadJwt,
  makeBrokenPayloadJwt,
  makeJwt,
  makeNonJsonPayloadJwt,
} from '../../helpers/jwt';

describe('decodeJwtPayload', () => {
  it('decodes a well-formed JWT payload', () => {
    const token = makeJwt({ sub: 'u1', email: 'a@b.c' });
    expect(decodeJwtPayload(token)).toEqual({ sub: 'u1', email: 'a@b.c' });
  });

  it('handles base64url payloads that need padding', () => {
    // Empty object encodes to "e30" which is 3 chars → needs 1 pad char.
    const token = makeJwt({});
    expect(decodeJwtPayload(token)).toEqual({});
  });

  it('handles payloads with `-` and `_` (base64url alphabet)', () => {
    // Build a payload whose base64 contains `+` and `/` so the url-safe
    // replace pass is exercised on input.
    const payload = { v: '????>>>' };
    const token = makeJwt(payload);
    expect(decodeJwtPayload(token)).toEqual(payload);
  });

  it('returns null for an empty string', () => {
    expect(decodeJwtPayload('')).toBeNull();
  });

  it('returns null when there are fewer than 2 segments', () => {
    expect(decodeJwtPayload('only-one')).toBeNull();
  });

  it('returns null when the payload segment is empty', () => {
    expect(decodeJwtPayload('header..sig')).toBeNull();
  });

  it('returns null for malformed base64url payloads', () => {
    expect(decodeJwtPayload(makeBrokenPayloadJwt())).toBeNull();
  });

  it('returns null when the payload is not JSON', () => {
    expect(decodeJwtPayload(makeNonJsonPayloadJwt())).toBeNull();
  });

  it('returns null when the payload is a JSON array', () => {
    expect(decodeJwtPayload(makeArrayPayloadJwt())).toBeNull();
  });

  it('does not throw on garbage input', () => {
    expect(() => decodeJwtPayload('???.???.???')).not.toThrow();
    expect(decodeJwtPayload('???.???.???')).toBeNull();
  });
});

describe('readRoleFromToken', () => {
  it('reads custom:role when present', () => {
    const token = makeJwt({ 'custom:role': 'admin_mac' });
    expect(readRoleFromToken(token)).toBe('admin_mac');
  });

  it('falls back to plain `role` when custom:role is absent', () => {
    const token = makeJwt({ role: 'operator' });
    expect(readRoleFromToken(token)).toBe('operator');
  });

  it('prefers custom:role over plain role when both exist', () => {
    const token = makeJwt({ 'custom:role': 'admin_mac', role: 'operator' });
    expect(readRoleFromToken(token)).toBe('admin_mac');
  });

  it('returns null when neither claim is present', () => {
    const token = makeJwt({ sub: 'u1' });
    expect(readRoleFromToken(token)).toBeNull();
  });

  it('returns null when the role claim is not a string', () => {
    const token = makeJwt({ 'custom:role': 42 });
    expect(readRoleFromToken(token)).toBeNull();
  });

  it('returns null for malformed tokens', () => {
    expect(readRoleFromToken('')).toBeNull();
    expect(readRoleFromToken('one-segment')).toBeNull();
    expect(readRoleFromToken(makeBrokenPayloadJwt())).toBeNull();
  });
});
