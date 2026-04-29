import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyBrandableTheme,
  clearBrandableTheme,
  escapeUrl,
  getContrastColor,
  isValidHex,
} from './brandable-tokens';

describe('isValidHex', () => {
  it('accepts 6-digit hex', () => {
    expect(isValidHex('#16a34a')).toBe(true);
    expect(isValidHex('#FFFFFF')).toBe(true);
  });
  it('rejects 3-digit and malformed', () => {
    expect(isValidHex('#abc')).toBe(false);
    expect(isValidHex('16a34a')).toBe(false);
    expect(isValidHex('#16a34g')).toBe(false);
    expect(isValidHex('javascript:alert(1)')).toBe(false);
  });
});

describe('escapeUrl', () => {
  it('accepts whitelisted CloudFront host', () => {
    expect(escapeUrl('https://abc123.cloudfront.net/branding/bg.png')).toBe(
      'https://abc123.cloudfront.net/branding/bg.png',
    );
  });
  it('rejects http://', () => {
    expect(escapeUrl('http://abc.cloudfront.net/x.png')).toBeNull();
  });
  it('rejects unknown host', () => {
    expect(escapeUrl('https://evil.example.com/x.png')).toBeNull();
  });
  it('rejects CSS-injection metacharacters', () => {
    expect(escapeUrl('https://abc.cloudfront.net/x.png");}body{background:red')).toBeNull();
    expect(escapeUrl('https://abc.cloudfront.net/x.png\\")')).toBeNull();
  });
  it('rejects empty / oversized', () => {
    expect(escapeUrl('')).toBeNull();
    expect(escapeUrl('https://abc.cloudfront.net/' + 'a'.repeat(2100))).toBeNull();
  });
});

describe('getContrastColor', () => {
  it('returns white on dark', () => {
    expect(getContrastColor('#000000')).toBe('#ffffff');
    expect(getContrastColor('#1f3a5f')).toBe('#ffffff');
  });
  it('returns near-black on light', () => {
    expect(getContrastColor('#ffffff')).toBe('#0a0a0a');
    expect(getContrastColor('#fde68a')).toBe('#0a0a0a');
  });
  it('falls back to dark on invalid', () => {
    expect(getContrastColor('not-a-hex')).toBe('#0a0a0a');
  });
});

describe('applyBrandableTheme', () => {
  beforeEach(() => {
    clearBrandableTheme();
  });

  it('sets the four tenant CSS vars', () => {
    const ok = applyBrandableTheme({ primaryHex: '#16a34a', accentHex: '#7c3aed' });
    expect(ok).toBe(true);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--tenant-primary')).toBe('#16a34a');
    expect(root.style.getPropertyValue('--tenant-accent')).toBe('#7c3aed');
    expect(root.style.getPropertyValue('--tenant-primary-fg')).toMatch(/^#(?:[0-9a-f]{6})$/i);
    expect(root.style.getPropertyValue('--tenant-accent-fg')).toMatch(/^#(?:[0-9a-f]{6})$/i);
  });

  it('rejects invalid hex without throwing', () => {
    const ok = applyBrandableTheme({ primaryHex: 'red', accentHex: '#7c3aed' });
    expect(ok).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--tenant-primary')).toBe('');
  });

  it('sets bg image url when whitelisted', () => {
    applyBrandableTheme({
      primaryHex: '#16a34a',
      accentHex: '#7c3aed',
      bgImageUrl: 'https://abc.cloudfront.net/bg.png',
    });
    const value = document.documentElement.style.getPropertyValue('--tenant-bg-image');
    expect(value).toContain('url(');
    expect(value).toContain('abc.cloudfront.net');
  });

  it('drops bg image when not whitelisted', () => {
    applyBrandableTheme({
      primaryHex: '#16a34a',
      accentHex: '#7c3aed',
      bgImageUrl: 'https://evil.example.com/bg.png',
    });
    expect(document.documentElement.style.getPropertyValue('--tenant-bg-image')).toBe('');
  });

  it('clearBrandableTheme removes all vars', () => {
    applyBrandableTheme({
      primaryHex: '#16a34a',
      accentHex: '#7c3aed',
      bgImageUrl: 'https://abc.cloudfront.net/bg.png',
    });
    clearBrandableTheme();
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--tenant-primary')).toBe('');
    expect(root.style.getPropertyValue('--tenant-accent')).toBe('');
    expect(root.style.getPropertyValue('--tenant-bg-image')).toBe('');
  });
});
