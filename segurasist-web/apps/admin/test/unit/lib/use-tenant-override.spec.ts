/**
 * S3-08 — `useTenantOverride` Zustand store tests.
 *
 * Properties bajo test:
 *  1. Initial state: `overrideTenantId === null`.
 *  2. setOverride / clearOverride mutan el state.
 *  3. NO persiste a localStorage / sessionStorage (security req #6).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useTenantOverride } from '../../../lib/hooks/use-tenant-override';

describe('useTenantOverride store (S3-08)', () => {
  afterEach(() => {
    // Reset entre tests para no contaminar (Zustand store es global).
    useTenantOverride.getState().clearOverride();
  });

  it('initial state: overrideTenantId=null, overrideTenantName=null', () => {
    const s = useTenantOverride.getState();
    expect(s.overrideTenantId).toBeNull();
    expect(s.overrideTenantName).toBeNull();
  });

  it('setOverride / clearOverride mutan el state', () => {
    useTenantOverride.getState().setOverride('tenant-123', 'Hospitales MAC');
    expect(useTenantOverride.getState().overrideTenantId).toBe('tenant-123');
    expect(useTenantOverride.getState().overrideTenantName).toBe('Hospitales MAC');

    useTenantOverride.getState().clearOverride();
    expect(useTenantOverride.getState().overrideTenantId).toBeNull();
    expect(useTenantOverride.getState().overrideTenantName).toBeNull();
  });

  it('NO persiste a localStorage (security: refresh resetea — anti-olvido)', () => {
    useTenantOverride.getState().setOverride('tenant-xyz', 'X');
    // Inspeccionamos localStorage en busca de cualquier rastro del tenant id.
    // Si Zustand `persist` middleware estuviera habilitado, lo encontraríamos
    // serializado bajo alguna key.
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k) keys.push(k);
    }
    for (const k of keys) {
      const v = window.localStorage.getItem(k);
      expect(v).not.toContain('tenant-xyz');
    }
    // Idem sessionStorage.
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k) {
        const v = window.sessionStorage.getItem(k);
        expect(v).not.toContain('tenant-xyz');
      }
    }
  });

  it('NO persiste a sessionStorage tampoco', () => {
    useTenantOverride.getState().setOverride('tenant-zzz', 'Z');
    expect(window.sessionStorage.length).toBe(0);
  });
});
