/**
 * S3-08 — `<TenantOverrideBanner />` tests.
 *
 * Cubre:
 *  - No renderiza nada cuando `overrideTenantId === null`.
 *  - Renderiza banner amber con el nombre del tenant cuando override activo.
 *  - El botón "Volver a mi tenant" llama clearOverride + invalidateQueries.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { TenantOverrideBanner } from '../../../components/layout/tenant-override-banner';
import { useTenantOverride } from '../../../lib/hooks/use-tenant-override';

function wrap(ui: ReactNode, qc?: QueryClient): ReactNode {
  const client =
    qc ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  useTenantOverride.getState().clearOverride();
});

describe('<TenantOverrideBanner /> (S3-08)', () => {
  it('NO renderiza nada cuando override está inactivo', () => {
    const { container } = render(wrap(<TenantOverrideBanner />));
    expect(container.firstChild).toBeNull();
  });

  it('renderiza banner amber con el nombre del tenant cuando override activo', () => {
    useTenantOverride.getState().setOverride('tenant-mac', 'Hospitales MAC');
    render(wrap(<TenantOverrideBanner />));
    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/operando como tenant/i);
    expect(banner).toHaveTextContent(/hospitales mac/i);
    expect(banner).toHaveTextContent(/admin_segurasist/i);
    // Reglas de color amber: revisamos por la clase clave `bg-amber-100`.
    expect(banner.className).toMatch(/amber/);
  });

  it('botón "Volver a mi tenant" → clearOverride + invalidateQueries', async () => {
    const user = userEvent.setup();
    useTenantOverride.getState().setOverride('tenant-mac', 'Hospitales MAC');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    render(wrap(<TenantOverrideBanner />, qc));

    await user.click(screen.getByRole('button', { name: /volver a mi tenant/i }));
    expect(useTenantOverride.getState().overrideTenantId).toBeNull();
    expect(invalidateSpy).toHaveBeenCalled();
  });
});
