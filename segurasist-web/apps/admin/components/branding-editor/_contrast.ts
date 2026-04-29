/**
 * Sprint 5 — MT-2 iter 1.
 *
 * WCAG AA contrast helpers. Pure functions, sin deps externas.
 * El backend valida hex con `^#[0-9a-fA-F]{6}$`; el FE valida lo mismo y
 * además calcula el contrast ratio contra blanco (#ffffff) para advertir
 * si un color de marca queda ilegible sobre fondo claro (typical SaaS).
 *
 * Fórmula: WCAG 2.x relative luminance.
 *   Lrel = 0.2126 R + 0.7152 G + 0.0722 B
 *   ratio = (Lmax + 0.05) / (Lmin + 0.05)
 * Threshold AA texto normal = 4.5.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHex(hex: string): boolean {
  return HEX_RE.test(hex);
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): RGB | null {
  if (!isValidHex(hex)) return null;
  const value = hex.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function relativeLuminance({ r, g, b }: RGB): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Devuelve el contrast ratio entre `hex` y blanco. 1 si el hex no es válido
 * (caller decide cómo presentar el warning — normalmente con isValidHex
 * antes).
 */
export function contrastVsWhite(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 1;
  const lum = relativeLuminance(rgb);
  // L blanco = 1.0 (canal=1 → no entra al `<= 0.03928` branch)
  return (1 + 0.05) / (lum + 0.05);
}

/** WCAG AA texto normal — recomendamos >= 4.5. */
export function passesWcagAa(hex: string): boolean {
  return contrastVsWhite(hex) >= 4.5;
}
