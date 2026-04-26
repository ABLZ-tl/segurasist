import { describe, expect, it, vi } from 'vitest';
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
    api: vi.fn(async () => ({ id: 'pkg-1', name: 'Premium' })),
  };
});

import { api } from '@segurasist/api-client';
import { PackageEditor } from '../../../components/packages/package-editor';

const mockedApi = vi.mocked(api);

function wrap(ui: ReactNode): ReactNode {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('<PackageEditor />', () => {
  it('shows validation error when name is too short', async () => {
    const user = userEvent.setup();
    render(wrap(<PackageEditor />));
    await user.click(screen.getByRole('button', { name: /crear paquete/i }));
    // El editor empuja errores a una <ul> con <li>; cada li tiene el path
    // y mensaje. Buscamos por li-content que arranca con "name:".
    const lis = await screen.findAllByRole('listitem');
    expect(
      lis.some((li) => /^name:/.test(li.textContent ?? '')),
    ).toBe(true);
  });

  it('submits POST /v1/packages with the form data on save', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(wrap(<PackageEditor onSaved={onSaved} />));

    await user.type(screen.getByLabelText(/nombre/i), 'Premium');
    await user.click(screen.getByRole('button', { name: /crear paquete/i }));

    await vi.waitFor(() => {
      expect(mockedApi).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockedApi.mock.calls[0]!;
    expect(url).toBe('/v1/packages');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(((init as RequestInit).body as string) ?? '{}');
    expect(body).toMatchObject({ name: 'Premium', status: 'active' });
  });

  it('PATCH path when initial.id is provided', async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <PackageEditor
          initial={{ id: 'pkg-1', name: 'Existing', coverages: [] }}
          onSaved={() => undefined}
        />,
      ),
    );
    await user.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await vi.waitFor(() => {
      expect(mockedApi).toHaveBeenCalled();
    });
    const [url, init] = mockedApi.mock.calls[0]!;
    expect(url).toBe('/v1/packages/pkg-1');
    expect((init as RequestInit).method).toBe('PATCH');
  });

  it('adds and removes coverages from the editor list', async () => {
    const user = userEvent.setup();
    render(wrap(<PackageEditor />));
    await user.click(screen.getByRole('button', { name: /agregar cobertura/i }));
    expect(screen.getAllByText(/tipo/i).length).toBeGreaterThan(0);
    const trash = screen.getByRole('button', { name: /eliminar cobertura/i });
    await user.click(trash);
    expect(screen.queryByRole('button', { name: /eliminar cobertura/i })).toBeNull();
  });

  it('blocks submit when a coverage is incomplete (missing limitCount)', async () => {
    const user = userEvent.setup();
    render(wrap(<PackageEditor />));
    await user.type(screen.getByLabelText(/nombre/i), 'Plus');
    await user.click(screen.getByRole('button', { name: /agregar cobertura/i }));
    // Coverage name + unit faltan + limitCount → debe validar y mostrar errores
    await user.click(screen.getByRole('button', { name: /crear paquete/i }));
    const lis = await screen.findAllByRole('listitem');
    expect(
      lis.some((li) => /^coverages\.0/.test(li.textContent ?? '')),
    ).toBe(true);
  });
});
