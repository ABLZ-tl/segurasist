/**
 * Tests unit Certificate portal — cubre render OK, atributos del botón
 * descargar (data-url para verificar que apuntamos a la pre-signed url) y
 * empty state cuando el backend devuelve 404.
 */

/**
 * framer-motion / next/* mocks viven en vitest.setup.ts. Aquí solo el hook.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CertificateMine } from '@segurasist/api-client/hooks/certificates';
import { ProblemDetailsError } from '@segurasist/api-client';

vi.mock('@segurasist/api-client/hooks/certificates', () => ({
  useCertificateMine: vi.fn(),
}));

import CertificatePage from '@/app/(app)/certificate/page';
import { useCertificateMine } from '@segurasist/api-client/hooks/certificates';

// Tiempos local a mediodía para evitar que `parseISO` + `format` shifteen el
// día por la timezone del runner (los `Z` de UTC sí lo causan).
const cert: CertificateMine = {
  url: 'https://signed.example.com/cert.pdf?sig=abc',
  expiresAt: '2026-04-26T10:00:00Z',
  certificateId: 'cert_1',
  version: 1,
  issuedAt: '2026-04-01T12:00:00',
  validTo: '2027-03-31T12:00:00',
};

function mockHook(value: Partial<ReturnType<typeof useCertificateMine>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCertificateMine).mockReturnValue(value as any);
}

describe('Portal CertificatePage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('render OK con preview iframe + subtitle con fechas formateadas', () => {
    mockHook({ data: cert, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    render(<CertificatePage />);
    expect(screen.getByTestId('certificate-content')).toBeInTheDocument();
    const iframe = screen.getByTestId('certificate-preview') as HTMLIFrameElement;
    expect(iframe).toHaveAttribute('src', cert.url);
    expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin');
    expect(screen.getByText(/1 de abril de 2026/)).toBeInTheDocument();
    expect(screen.getByText(/31 de marzo de 2027/)).toBeInTheDocument();
  });

  it('botón download tiene data-url con la URL pre-firmada del backend', () => {
    mockHook({ data: cert, isLoading: false, isError: false, error: null, refetch: vi.fn() });
    render(<CertificatePage />);
    expect(screen.getByTestId('certificate-download')).toHaveAttribute(
      'data-url',
      cert.url,
    );
    // Mailto contiene la URL escapada
    const share = screen.getByTestId('certificate-share') as HTMLAnchorElement;
    expect(share.href).toMatch(/^mailto:/);
    expect(decodeURIComponent(share.href)).toContain(cert.url);
  });

  it('empty state cuando el hook devuelve error 404 (ProblemDetailsError)', () => {
    const err = new ProblemDetailsError(
      { type: 'about:blank', title: 'Not found', status: 404 },
      'trace-1',
    );
    mockHook({
      data: undefined,
      isLoading: false,
      isError: true,
      error: err,
      refetch: vi.fn(),
    });
    render(<CertificatePage />);
    expect(screen.getByTestId('certificate-empty')).toBeInTheDocument();
    expect(
      screen.getByText(/aún no tienes un certificado/i),
    ).toBeInTheDocument();
  });
});
