/**
 * Tests unit Home portal — cubre las 3 variantes de StatusHeroCard, loading,
 * error y el link a soporte.
 *
 * Globals (vitest.setup.ts): framer-motion, next/navigation, next/headers,
 * next/font ya están mockeados. Aquí solo el hook del api-client + next/link
 * (sin RouterContext el <Link> de Next 14 explota).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { InsuredSelf } from '@segurasist/api-client/hooks/insureds';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@segurasist/api-client/hooks/insureds', () => ({
  useInsuredSelf: vi.fn(),
}));

import HomePage from '@/app/(app)/page';
import { useInsuredSelf } from '@segurasist/api-client/hooks/insureds';

// Usamos ISO con tiempo a mediodía local para que `parseISO` no shifteee a
// otro día por timezone (esp. en runners en UTC vs TZ del MX dev).
const baseInsured: InsuredSelf = {
  id: 'ins_1',
  fullName: 'Carmen López Hernández',
  packageId: 'pkg_premium',
  packageName: 'Premium',
  validFrom: '2026-04-01T12:00:00',
  validTo: '2027-03-31T12:00:00',
  status: 'vigente',
  daysUntilExpiry: 340,
  supportPhone: '+528001234567',
};

function mockHook(value: Partial<ReturnType<typeof useInsuredSelf>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useInsuredSelf).mockReturnValue(value as any);
}

describe('Portal HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('vigente: renderiza badge verde, label VIGENTE y fecha formateada', () => {
    mockHook({ data: baseInsured, isLoading: false, isError: false, refetch: vi.fn() });
    render(<HomePage />);
    const hero = screen.getByTestId('hero-vigente');
    expect(hero).toBeInTheDocument();
    expect(hero.className).toMatch(/border-success/);
    expect(screen.getByText('VIGENTE')).toBeInTheDocument();
    // 31 marzo 2027 en es-MX
    expect(screen.getByText(/31 de marzo de 2027/)).toBeInTheDocument();
    expect(screen.getByText('Carmen')).toBeInTheDocument();
  });

  it('proxima_a_vencer: hero con tono warning y label PRÓXIMA A VENCER', () => {
    mockHook({
      data: { ...baseInsured, status: 'proxima_a_vencer', daysUntilExpiry: 12 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<HomePage />);
    const hero = screen.getByTestId('hero-proxima_a_vencer');
    expect(hero.className).toMatch(/border-warning/);
    expect(screen.getByText('PRÓXIMA A VENCER')).toBeInTheDocument();
  });

  it('vencida: hero con tono danger y label VENCIDA', () => {
    mockHook({
      data: { ...baseInsured, status: 'vencida', daysUntilExpiry: -3 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<HomePage />);
    const hero = screen.getByTestId('hero-vencida');
    expect(hero.className).toMatch(/border-danger/);
    expect(screen.getByText('VENCIDA')).toBeInTheDocument();
  });

  it('loading: pinta el skeleton (no pantalla en blanco)', () => {
    mockHook({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    render(<HomePage />);
    expect(screen.getByTestId('home-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('home-content')).toBeNull();
  });

  it('error: pinta error state con botón reintentar que invoca refetch', async () => {
    const refetch = vi.fn();
    mockHook({ data: undefined, isLoading: false, isError: true, refetch });
    render(<HomePage />);
    const error = screen.getByTestId('home-error');
    expect(error).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /reintentar/i });
    btn.click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('link de soporte usa tel: con el supportPhone del backend', () => {
    mockHook({ data: baseInsured, isLoading: false, isError: false, refetch: vi.fn() });
    render(<HomePage />);
    const link = screen.getByTestId('support-phone-link');
    expect(link).toHaveAttribute('href', 'tel:+528001234567');
  });
});
