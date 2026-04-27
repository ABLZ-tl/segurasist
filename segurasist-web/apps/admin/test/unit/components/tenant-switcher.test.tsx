/**
 * S3-08 — `<TenantSwitcher />` tests.
 *
 * Cubre:
 *  - Solo visible (con dropdown) para `admin_segurasist`. Otros roles ven la
 *    versión read-only.
 *  - Dropdown carga la lista vía /v1/tenants/active (TanStack Query).
 *  - Al seleccionar un tenant: setOverride se invoca + queryClient.invalidateQueries.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

vi.mock('@segurasist/api-client', async () => {
  const actual = await vi.importActual<typeof import('@segurasist/api-client')>(
    '@segurasist/api-client',
  );
  return {
    ...actual,
    api: vi.fn(),
  };
});

import { api } from '@segurasist/api-client';
import { TenantSwitcher } from '../../../components/header/tenant-switcher';
import { useTenantOverride } from '../../../lib/hooks/use-tenant-override';

const mockedApi = vi.mocked(api);

const TENANTS = [
  { id: 'tenant-mac', name: 'Hospitales MAC', slug: 'mac' },
  { id: 'tenant-demo', name: 'Demo', slug: 'demo' },
];

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
  mockedApi.mockReset();
});

describe('<TenantSwitcher /> visibilidad por rol (S3-08)', () => {
  it('admin_segurasist: renderiza el dropdown editable', async () => {
    mockedApi.mockResolvedValueOnce(TENANTS);
    render(wrap(<TenantSwitcher role="admin_segurasist" />));
    expect(await screen.findByLabelText(/cambiar tenant/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /cambiar tenant/i })).toBeInTheDocument();
  });

  it('admin_mac: renderiza versión read-only (sin dropdown)', () => {
    render(wrap(<TenantSwitcher role="admin_mac" ownTenantLabel="Hospitales MAC" />));
    expect(screen.getByLabelText(/tenant actual/i)).toHaveTextContent(/hospitales mac/i);
    expect(screen.queryByRole('combobox')).toBeNull();
    // Tampoco debe haberse pegado al backend para tenants/active.
    expect(mockedApi).not.toHaveBeenCalled();
  });
});

describe('<TenantSwitcher /> dropdown — admin_segurasist', () => {
  it('carga lista de tenants vía /v1/tenants/active', async () => {
    mockedApi.mockResolvedValueOnce(TENANTS);
    render(wrap(<TenantSwitcher role="admin_segurasist" />));
    // Default option presente desde el primer render.
    expect(await screen.findByText(/mi tenant \(sin override\)/i)).toBeInTheDocument();
    await vi.waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/v1/tenants/active'));
    // Después del fetch, las opciones deberían aparecer.
    await screen.findByRole('option', { name: /hospitales mac/i });
    expect(screen.getByRole('option', { name: /demo/i })).toBeInTheDocument();
  });

  it('seleccionar un tenant dispara setOverride + invalidateQueries', async () => {
    const user = userEvent.setup();
    mockedApi.mockResolvedValueOnce(TENANTS);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    render(wrap(<TenantSwitcher role="admin_segurasist" />, qc));

    await screen.findByRole('option', { name: /hospitales mac/i });
    await user.selectOptions(screen.getByRole('combobox', { name: /cambiar tenant/i }), 'tenant-mac');

    expect(useTenantOverride.getState().overrideTenantId).toBe('tenant-mac');
    expect(useTenantOverride.getState().overrideTenantName).toBe('Hospitales MAC');
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('seleccionar "Mi tenant (sin override)" → clearOverride', async () => {
    const user = userEvent.setup();
    mockedApi.mockResolvedValueOnce(TENANTS);
    useTenantOverride.getState().setOverride('tenant-mac', 'Hospitales MAC');
    render(wrap(<TenantSwitcher role="admin_segurasist" />));
    await screen.findByRole('option', { name: /hospitales mac/i });

    await user.selectOptions(screen.getByRole('combobox', { name: /cambiar tenant/i }), '__none__');
    expect(useTenantOverride.getState().overrideTenantId).toBeNull();
  });
});
