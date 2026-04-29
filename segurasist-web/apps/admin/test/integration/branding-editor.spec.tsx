/**
 * Sprint 5 — MT-2 iter 1.
 *
 * Integration tests del <BrandingEditor>.
 *
 * Mockea los hooks de `@segurasist/api-client/hooks/admin-tenants` y
 * los toasts (sonner). Cubre:
 *   1. Skeleton mientras isLoading=true.
 *   2. Render con datos mock — el form se siembra con ellos.
 *   3. Cambiar displayName → onSubmit invoca updateBranding.mutateAsync con
 *      el nuevo valor.
 *   4. ColorPicker hex sync: typing en text actualiza color, viceversa.
 *   5. WCAG warning aparece para hex bajo contraste (#fafafa contra blanco).
 *   6. Logo dropzone reject >512KB (blob mock).
 *   7. Logo dropzone accept png happy → onUpload llamado.
 *   8. Preview pane refleja cambios live (displayName y tagline).
 *   9. Botón "Guardar" disabled si no hay dirty.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@segurasist/api-client/hooks/admin-tenants', () => ({
  useTenantBranding: vi.fn(),
  useUpdateBrandingMutation: vi.fn(),
  useUploadLogoMutation: vi.fn(),
  useDeleteLogoMutation: vi.fn(),
  tenantBrandingKeys: {
    all: ['tenant-branding'],
    detail: (id: string) => ['tenant-branding', id],
    portalSelf: ['tenant-branding-self'],
  },
}));

vi.mock('@segurasist/ui', async () => {
  const actual = await vi.importActual<typeof import('@segurasist/ui')>(
    '@segurasist/ui',
  );
  return {
    ...actual,
    toast: Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    }),
  };
});

import {
  useTenantBranding,
  useUpdateBrandingMutation,
  useUploadLogoMutation,
  useDeleteLogoMutation,
  type TenantBranding,
} from '@segurasist/api-client/hooks/admin-tenants';
import { BrandingEditor } from '../../components/branding-editor/branding-editor';

const mockedBranding = vi.mocked(useTenantBranding);
const mockedUpdate = vi.mocked(useUpdateBrandingMutation);
const mockedUpload = vi.mocked(useUploadLogoMutation);
const mockedDelete = vi.mocked(useDeleteLogoMutation);

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

function makeBranding(overrides: Partial<TenantBranding> = {}): TenantBranding {
  return {
    tenantId: TENANT_ID,
    displayName: 'Hospital MAC',
    tagline: 'Tu salud, sin papeleo.',
    logoUrl: 'https://cdn.example.com/logo.png',
    primaryHex: '#1f3a8a',
    accentHex: '#0ea5e9',
    bgImageUrl: null,
    lastUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

interface MutationStub {
  mutateAsync: ReturnType<typeof vi.fn>;
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
  error: unknown;
}

function setup({
  branding = makeBranding(),
  isLoading = false,
  isError = false,
  updateAsync = vi.fn().mockResolvedValue(undefined),
  uploadMutate = vi.fn(),
  deleteMutate = vi.fn(),
  uploadError = null,
}: Partial<{
  branding: TenantBranding | undefined;
  isLoading: boolean;
  isError: boolean;
  updateAsync: ReturnType<typeof vi.fn>;
  uploadMutate: ReturnType<typeof vi.fn>;
  deleteMutate: ReturnType<typeof vi.fn>;
  uploadError: unknown;
}> = {}): {
  updateMut: MutationStub;
  uploadMut: MutationStub;
  deleteMut: MutationStub;
} {
  mockedBranding.mockReturnValue({
    data: isLoading || isError ? undefined : branding,
    isLoading,
    isError,
    error: isError ? new Error('boom') : null,
    isFetching: false,
  } as never);

  const updateMut: MutationStub = {
    mutateAsync: updateAsync,
    mutate: vi.fn(),
    isPending: false,
    error: null,
  };
  const uploadMut: MutationStub = {
    mutateAsync: vi.fn(),
    mutate: uploadMutate,
    isPending: false,
    error: uploadError,
  };
  const deleteMut: MutationStub = {
    mutateAsync: vi.fn(),
    mutate: deleteMutate,
    isPending: false,
    error: null,
  };
  mockedUpdate.mockReturnValue(updateMut as never);
  mockedUpload.mockReturnValue(uploadMut as never);
  mockedDelete.mockReturnValue(deleteMut as never);

  return { updateMut, uploadMut, deleteMut };
}

beforeEach(() => {
  mockedBranding.mockReset();
  mockedUpdate.mockReset();
  mockedUpload.mockReset();
  mockedDelete.mockReset();
});

describe('<BrandingEditor /> — loading / error', () => {
  it('muestra skeleton mientras isLoading=true', () => {
    setup({ isLoading: true });
    render(<BrandingEditor tenantId={TENANT_ID} />);
    expect(screen.getByTestId('branding-editor-skeleton')).toBeInTheDocument();
  });

  it('muestra AlertBanner cuando isError=true', () => {
    setup({ isError: true });
    render(<BrandingEditor tenantId={TENANT_ID} />);
    expect(screen.getByText(/no pudimos cargar el branding/i)).toBeInTheDocument();
  });
});

describe('<BrandingEditor /> — render con datos', () => {
  it('siembra el form con los datos del hook', async () => {
    setup();
    render(<BrandingEditor tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(
        (screen.getByTestId('branding-displayName') as HTMLInputElement).value,
      ).toBe('Hospital MAC');
    });
    expect(
      (screen.getByTestId('branding-tagline') as HTMLInputElement).value,
    ).toBe('Tu salud, sin papeleo.');
    expect(screen.getByTestId('branding-last-updated')).toBeInTheDocument();
  });

  it('preview pane refleja displayName y tagline', async () => {
    setup();
    render(<BrandingEditor tenantId={TENANT_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('branding-preview-name')).toHaveTextContent(
        'Hospital MAC',
      );
    });
    expect(screen.getByTestId('branding-preview-tagline')).toHaveTextContent(
      'Tu salud, sin papeleo.',
    );
  });

  it('preview pane se actualiza live al cambiar displayName', async () => {
    setup();
    const user = userEvent.setup();
    render(<BrandingEditor tenantId={TENANT_ID} />);
    const input = await screen.findByTestId('branding-displayName');
    await user.clear(input);
    await user.type(input, 'Mi Empresa');
    await waitFor(() =>
      expect(screen.getByTestId('branding-preview-name')).toHaveTextContent(
        'Mi Empresa',
      ),
    );
  });
});

describe('<BrandingEditor /> — submit', () => {
  it('botón Guardar disabled cuando el form no es dirty', async () => {
    setup();
    render(<BrandingEditor tenantId={TENANT_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId('branding-displayName')).toBeInTheDocument(),
    );
    const btn = screen.getByTestId('branding-save-btn') as HTMLButtonElement;
    expect(btn).toBeDisabled();
  });

  it('cambiar displayName → submit llama updateBranding.mutateAsync con valor nuevo', async () => {
    const updateAsync = vi.fn().mockResolvedValue(undefined);
    setup({ updateAsync });
    const user = userEvent.setup();
    render(<BrandingEditor tenantId={TENANT_ID} />);
    const input = await screen.findByTestId('branding-displayName');
    await user.clear(input);
    await user.type(input, 'Nuevo Nombre');
    const btn = screen.getByTestId('branding-save-btn') as HTMLButtonElement;
    await waitFor(() => expect(btn).not.toBeDisabled());
    await user.click(btn);
    await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
    expect(updateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Nuevo Nombre' }),
    );
  });
});

describe('<BrandingEditor /> — color picker', () => {
  it('typing hex válido en text input actualiza color picker (sync)', async () => {
    setup();
    const user = userEvent.setup();
    render(<BrandingEditor tenantId={TENANT_ID} />);
    const text = await screen.findByTestId('color-picker-primary-text');
    await user.clear(text);
    await user.type(text, '#ff0000');
    const native = screen.getByTestId(
      'color-picker-primary-native',
    ) as HTMLInputElement;
    await waitFor(() => expect(native.value).toBe('#ff0000'));
  });

  it('WCAG warning aparece para hex con bajo contraste contra blanco (#fafafa)', async () => {
    setup();
    const user = userEvent.setup();
    render(<BrandingEditor tenantId={TENANT_ID} />);
    const text = await screen.findByTestId('color-picker-primary-text');
    await user.clear(text);
    await user.type(text, '#fafafa');
    const badge = await screen.findByTestId('color-picker-primary-wcag');
    expect(badge).toHaveAttribute('data-wcag-pass', 'false');
    expect(badge).toHaveTextContent(/contraste bajo/i);
  });

  it('WCAG pass para color con contraste alto (#1f3a8a default)', async () => {
    setup();
    render(<BrandingEditor tenantId={TENANT_ID} />);
    const badge = await screen.findByTestId('color-picker-primary-wcag');
    await waitFor(() =>
      expect(badge).toHaveAttribute('data-wcag-pass', 'true'),
    );
  });
});

describe('<BrandingEditor /> — logo dropzone', () => {
  it('rechaza archivo >512KB (no llama uploadMutation.mutate)', async () => {
    const uploadMutate = vi.fn();
    setup({ uploadMutate, branding: makeBranding({ logoUrl: null }) });
    const user = userEvent.setup();
    render(<BrandingEditor tenantId={TENANT_ID} />);
    const input = (await screen.findByTestId(
      'logo-dropzone-input',
    )) as HTMLInputElement;
    // 600KB de bytes random
    const bigBytes = new Uint8Array(600 * 1024);
    const big = new File([bigBytes], 'big.png', { type: 'image/png' });
    await user.upload(input, big);
    await waitFor(() =>
      expect(screen.getByTestId('logo-dropzone-error')).toBeInTheDocument(),
    );
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it('acepta png pequeño (happy path) → uploadMutation.mutate invocado', async () => {
    const uploadMutate = vi.fn();
    setup({ uploadMutate, branding: makeBranding({ logoUrl: null }) });
    const user = userEvent.setup();
    render(<BrandingEditor tenantId={TENANT_ID} />);
    const input = (await screen.findByTestId(
      'logo-dropzone-input',
    )) as HTMLInputElement;
    // Archivo SVG (la validación de dimensiones se salta para SVG → permite
    // testear el happy path sin polyfillear `Image()` en jsdom).
    const small = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"></svg>'],
      'logo.svg',
      { type: 'image/svg+xml' },
    );
    await user.upload(input, small);
    await waitFor(() =>
      expect(uploadMutate).toHaveBeenCalledTimes(1),
    );
    expect(uploadMutate.mock.calls[0]?.[0]).toBeInstanceOf(File);
  });

  it('rechaza tipo no soportado (text/plain)', async () => {
    const uploadMutate = vi.fn();
    setup({ uploadMutate, branding: makeBranding({ logoUrl: null }) });
    const user = userEvent.setup();
    render(<BrandingEditor tenantId={TENANT_ID} />);
    const input = (await screen.findByTestId(
      'logo-dropzone-input',
    )) as HTMLInputElement;
    const bad = new File(['not an image'], 'logo.txt', { type: 'text/plain' });
    // user-event v14 filtra por `accept` cuando `applyAccept` no es false en
    // ciertos releases; usamos `fireEvent.change` para entregar el archivo
    // sin atravesar el filtro y verificar que la validación cliente-side
    // propia del dropzone (file-magic / mime check) rechaza el tipo.
    fireEvent.change(input, { target: { files: [bad] } });
    void user;
    await waitFor(() =>
      expect(screen.getByTestId('logo-dropzone-error')).toHaveTextContent(
        /formato no soportado/i,
      ),
    );
    expect(uploadMutate).not.toHaveBeenCalled();
  });
});

describe('<BrandingEditor /> — restore default', () => {
  it('botón Restaurar abre modal y al confirmar reinicia el form', async () => {
    setup();
    const user = userEvent.setup();
    render(<BrandingEditor tenantId={TENANT_ID} />);
    await screen.findByTestId('branding-displayName');
    await user.click(screen.getByTestId('branding-restore-btn'));
    const confirm = await screen.findByTestId('branding-restore-confirm');
    await user.click(confirm);
    await waitFor(() => {
      expect(
        (screen.getByTestId('branding-displayName') as HTMLInputElement).value,
      ).toBe('SegurAsist');
    });
  });
});
