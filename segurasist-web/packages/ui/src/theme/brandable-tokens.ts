/**
 * Brandable theme runtime — DS-1 (Sprint 5).
 *
 * MT-3 invokes `applyBrandableTheme` from the portal's `TenantProvider` with
 * the `/v1/tenants/me/branding` payload, after the JWT is validated. The
 * helpers run inside `useEffect`, so they are SSR-safe but ALSO guard
 * `typeof document` to keep unit tests deterministic.
 */

export interface BrandableTheme {
  primaryHex: string;
  accentHex: string;
  bgImageUrl?: string | null;
}

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Whitelist of hosts allowed in `--tenant-bg-image`. Backed by CloudFront
 * distributions we own — see ADR-0013. MT-1's CSP must keep these in
 * `img-src` (and `style-src` if we ever inline the URL via attribute).
 */
const BG_IMAGE_HOST_ALLOWLIST: ReadonlyArray<RegExp> = [
  /^https:\/\/[a-z0-9-]+\.cloudfront\.net\//i,
  /^https:\/\/cdn\.segurasist\.com\//i,
  /^https:\/\/branding-assets-[a-z0-9-]+\.s3\.amazonaws\.com\//i,
];

export function isValidHex(value: string): boolean {
  return HEX_REGEX.test(value);
}

/**
 * Validates an external background image URL. Rejects anything that is not
 * an absolute https URL on a host we control. Returns the canonical URL or
 * `null` when invalid.
 */
export function escapeUrl(rawUrl: string): string | null {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 2048) {
    return null;
  }
  // Reject anything containing CSS-injection metacharacters before we even
  // try to parse: parentheses, quotes, semicolons, escapes, and backslashes.
  if (/[\s"'`\\();{}<>]/.test(rawUrl)) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  const matchesAllowlist = BG_IMAGE_HOST_ALLOWLIST.some((re) => re.test(parsed.toString()));
  if (!matchesAllowlist) {
    return null;
  }
  return parsed.toString();
}

/**
 * Computes a foreground color (white or near-black) that meets WCAG AA
 * contrast against the given hex background. Algorithm: relative luminance
 * per WCAG 2.x §1.4.3.
 */
export function getContrastColor(hex: string): string {
  if (!isValidHex(hex)) return '#0a0a0a';
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  // 0.5 is a reasonable midpoint between contrast against white (1.0) and
  // black (0.0). Tuned against the SegurAsist palette.
  return luminance > 0.5 ? '#0a0a0a' : '#ffffff';
}

/**
 * Applies the brandable theme to `document.documentElement` as CSS variables.
 * No-op when called outside a browser environment (e.g. during SSR or in a
 * unit test that has not yet configured jsdom). Returns `false` in that case
 * so callers can detect skipped applications.
 */
export function applyBrandableTheme(theme: BrandableTheme): boolean {
  if (typeof document === 'undefined' || !document.documentElement) {
    return false;
  }
  if (!isValidHex(theme.primaryHex) || !isValidHex(theme.accentHex)) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[brandable-tokens] invalid hex provided; skipping theme application');
    }
    return false;
  }
  const root = document.documentElement;
  root.style.setProperty('--tenant-primary', theme.primaryHex);
  root.style.setProperty('--tenant-primary-fg', getContrastColor(theme.primaryHex));
  root.style.setProperty('--tenant-accent', theme.accentHex);
  root.style.setProperty('--tenant-accent-fg', getContrastColor(theme.accentHex));

  if (theme.bgImageUrl) {
    const safe = escapeUrl(theme.bgImageUrl);
    if (safe) {
      root.style.setProperty('--tenant-bg-image', `url("${safe}")`);
    } else {
      root.style.removeProperty('--tenant-bg-image');
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[brandable-tokens] bgImageUrl rejected by allowlist');
      }
    }
  } else {
    root.style.removeProperty('--tenant-bg-image');
  }
  return true;
}

/**
 * Removes all `--tenant-*` overrides, returning the document to the default
 * theme. Useful on logout, on tenant switch, and in test teardown.
 */
export function clearBrandableTheme(): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const root = document.documentElement;
  root.style.removeProperty('--tenant-primary');
  root.style.removeProperty('--tenant-primary-fg');
  root.style.removeProperty('--tenant-accent');
  root.style.removeProperty('--tenant-accent-fg');
  root.style.removeProperty('--tenant-bg-image');
}
