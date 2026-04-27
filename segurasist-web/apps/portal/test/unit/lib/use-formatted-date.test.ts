/**
 * Tests unit helpers de fecha es-MX. Locale fijo (sin Intl global override),
 * fechas ISO sin tz para evitar el shift por timezone del runner.
 */

import { describe, it, expect } from 'vitest';
import {
  formatLongDate,
  formatRelativeDate,
  formatShortDate,
} from '@/lib/hooks/use-formatted-date';

describe('use-formatted-date', () => {
  it('formatLongDate: ISO YYYY-MM-DD → "d de MMMM de yyyy" en es-MX', () => {
    // Usar `T00:00:00` evita el shift por timezone del runner.
    expect(formatLongDate('2027-03-31T00:00:00')).toBe('31 de marzo de 2027');
    expect(formatLongDate('2026-04-01T00:00:00')).toBe('1 de abril de 2026');
  });

  it('formatShortDate: ISO → "d de MMM yyyy"', () => {
    expect(formatShortDate('2027-03-31T00:00:00')).toBe('31 de mar 2027');
  });

  it('formatRelativeDate: agrega "hace" como sufijo', () => {
    const now = new Date();
    const tenDaysAgo = new Date(now);
    tenDaysAgo.setDate(now.getDate() - 10);
    const out = formatRelativeDate(tenDaysAgo.toISOString());
    expect(out).toMatch(/hace/i);
  });
});
