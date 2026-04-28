/**
 * H-14 — Tests del helper runtime `assertPlatformAdmin`.
 */
import { ForbiddenException } from '@nestjs/common';
import { assertPlatformAdmin } from './assert-platform-admin';

describe('assertPlatformAdmin (H-14)', () => {
  it('user undefined → ForbiddenException', () => {
    expect(() => assertPlatformAdmin(undefined)).toThrow(ForbiddenException);
  });

  it('user null → ForbiddenException', () => {
    expect(() => assertPlatformAdmin(null)).toThrow(ForbiddenException);
  });

  it('user sin role ni platformAdmin → ForbiddenException', () => {
    expect(() => assertPlatformAdmin({})).toThrow(ForbiddenException);
  });

  it('role admin_mac (no platform admin) → ForbiddenException', () => {
    expect(() => assertPlatformAdmin({ role: 'admin_mac' })).toThrow(ForbiddenException);
  });

  it('role insured → ForbiddenException', () => {
    expect(() => assertPlatformAdmin({ role: 'insured' })).toThrow(ForbiddenException);
  });

  it('role admin_segurasist → pasa sin throw', () => {
    expect(() => assertPlatformAdmin({ role: 'admin_segurasist' })).not.toThrow();
  });

  it('platformAdmin=true (sin role) → pasa sin throw', () => {
    expect(() => assertPlatformAdmin({ platformAdmin: true })).not.toThrow();
  });

  it('platformAdmin=true gana sobre role no admin (defense-in-depth, no debería darse pero el guard lo permite)', () => {
    // El JwtAuthGuard sólo setea platformAdmin=true si role==='admin_segurasist',
    // pero el helper no asume eso para no acoplarse al guard.
    expect(() => assertPlatformAdmin({ role: 'operator', platformAdmin: true })).not.toThrow();
  });

  it('mensaje del error es estable para tests integration upstream', () => {
    try {
      assertPlatformAdmin({ role: 'operator' });
      throw new Error('no debería llegar aquí');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).message).toBe('platform_admin role required');
    }
  });
});
