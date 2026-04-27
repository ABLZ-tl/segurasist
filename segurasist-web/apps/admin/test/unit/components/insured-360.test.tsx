/**
 * S3-06 — Tests del Insured360Client + sus 5 tabs.
 *
 * Cobertura:
 *  - Loading state (Skeleton).
 *  - Render de las 5 secciones con data mock.
 *  - URL state via `?tab=...`.
 *  - Empty states de cada tab.
 *  - Acción de expandir payloadDiff en auditoría.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Insured360 } from '@segurasist/api-client';

vi.mock('@segurasist/api-client/hooks/insureds', () => ({
  useInsured360: vi.fn(),
  insuredsKeys: { view360: (id: string) => ['insureds', '360', id] },
}));

import { useInsured360 } from '@segurasist/api-client/hooks/insureds';
import { Insured360Client } from '../../../app/(app)/insureds/[id]/insured-360-client';
import { InsuredDatosTab } from '../../../app/(app)/insureds/[id]/datos';
import { InsuredCoberturasTab } from '../../../app/(app)/insureds/[id]/coberturas';
import { InsuredEventosTab } from '../../../app/(app)/insureds/[id]/eventos';
import { InsuredCertificadosTab } from '../../../app/(app)/insureds/[id]/certificados';
import { InsuredAuditoriaTab } from '../../../app/(app)/insureds/[id]/auditoria';

const mockedUseInsured360 = vi.mocked(useInsured360);

const FIXTURE: Insured360 = {
  insured: {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    curp: 'AAAA800101HDFRRR01',
    rfc: 'AAAA800101AAA',
    fullName: 'Carmen López',
    dob: '1980-01-01',
    email: 'carmen@example.com',
    phone: '+525555555555',
    packageId: 'pkg-1',
    packageName: 'Plan Plus',
    validFrom: '2026-01-01',
    validTo: '2027-01-01',
    status: 'active',
    entidad: 'CDMX',
    numeroEmpleadoExterno: 'EMP-99',
    beneficiaries: [
      { id: 'b1', fullName: 'Hijo López', dob: '2010-05-10', relationship: 'child' },
    ],
    createdAt: '2026-04-25T12:00:00.000Z',
    updatedAt: '2026-04-25T12:00:00.000Z',
  },
  coverages: [
    { id: 'c1', name: 'Consultas', type: 'count', limit: 12, used: 4, unit: 'eventos', lastUsedAt: null },
  ],
  events: [
    {
      id: 'ev1',
      type: 'consultation',
      reportedAt: '2026-04-20T10:00:00.000Z',
      description: 'Consulta general',
      status: 'reported',
      amountEstimated: 1200,
    },
  ],
  certificates: [
    {
      id: 'cert1',
      version: 1,
      issuedAt: '2026-03-01T10:00:00.000Z',
      validTo: '2027-03-01',
      status: 'issued',
      hash: 'abcdef1234567890',
      qrPayload: 'qr-1',
    },
  ],
  audit: [
    {
      id: 'au1',
      action: 'read',
      actorEmail: 'op@mac.local',
      resourceType: 'insureds',
      resourceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      occurredAt: '2026-04-25T12:00:00.000Z',
      ip: '189.10.20.30',
      payloadDiff: { subAction: 'viewed_360' },
    },
  ],
};

function loadOk(): void {
  mockedUseInsured360.mockReturnValue({
    data: FIXTURE,
    isLoading: false,
    isError: false,
    error: null,
  } as never);
}

describe('<Insured360Client /> — main wrapper', () => {
  it('muestra skeleton mientras isLoading=true', () => {
    mockedUseInsured360.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    } as never);
    render(<Insured360Client insuredId={FIXTURE.insured.id} />);
    expect(screen.getByTestId('insured-360-skeleton')).toBeInTheDocument();
  });

  it('renderiza header con nombre + CURP + badge vigente', () => {
    loadOk();
    render(<Insured360Client insuredId={FIXTURE.insured.id} />);
    // El nombre aparece en breadcrumb + heading: usamos heading explicit.
    expect(screen.getAllByText('Carmen López').length).toBeGreaterThan(0);
    expect(screen.getByText(/CURP:/)).toBeInTheDocument();
    expect(screen.getByText('Vigente')).toBeInTheDocument();
    expect(screen.getByTestId('reissue-cert-btn')).toBeInTheDocument();
  });

  it('renderiza los 5 tabs', () => {
    loadOk();
    render(<Insured360Client insuredId={FIXTURE.insured.id} />);
    expect(screen.getByRole('tab', { name: /datos/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /coberturas/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /eventos/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /certificados/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /auditoría/i })).toBeInTheDocument();
  });

  it('cambia de tab al hacer click y dispara router.replace', async () => {
    loadOk();
    const user = userEvent.setup();
    const { useRouter } = await import('next/navigation');
    const router = useRouter();
    render(<Insured360Client insuredId={FIXTURE.insured.id} />);
    await user.click(screen.getByRole('tab', { name: /coberturas/i }));
    expect(router.replace).toHaveBeenCalled();
    const call = (router.replace as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(call).toContain('tab=coberturas');
  });
});

describe('<InsuredDatosTab />', () => {
  it('renderiza datos personales y póliza con beneficiarios', () => {
    render(<InsuredDatosTab insured={FIXTURE.insured} />);
    expect(screen.getByText('AAAA800101HDFRRR01')).toBeInTheDocument();
    expect(screen.getByText('Plan Plus')).toBeInTheDocument();
    expect(screen.getByText('CDMX')).toBeInTheDocument();
    expect(screen.getByText('EMP-99')).toBeInTheDocument();
    expect(screen.getByText(/Hijo López/)).toBeInTheDocument();
  });

  it('muestra "Sin beneficiarios registrados" cuando la lista está vacía', () => {
    render(<InsuredDatosTab insured={{ ...FIXTURE.insured, beneficiaries: [] }} />);
    expect(screen.getByText(/sin beneficiarios/i)).toBeInTheDocument();
  });
});

describe('<InsuredCoberturasTab />', () => {
  it('renderiza cards con uso por cobertura', () => {
    render(<InsuredCoberturasTab coverages={FIXTURE.coverages} />);
    expect(screen.getByText('Consultas')).toBeInTheDocument();
    // "4 de 12 (eventos)" → fragmentos.
    expect(screen.getByText(/de 12/)).toBeInTheDocument();
  });

  it('empty state cuando coverages=[]', () => {
    render(<InsuredCoberturasTab coverages={[]} />);
    expect(screen.getByText(/sin coberturas configuradas/i)).toBeInTheDocument();
  });
});

describe('<InsuredEventosTab />', () => {
  it('renderiza timeline con eventos', () => {
    render(<InsuredEventosTab events={FIXTURE.events} />);
    expect(screen.getByTestId('events-timeline')).toBeInTheDocument();
    expect(screen.getByText('consultation')).toBeInTheDocument();
    expect(screen.getByText('Consulta general')).toBeInTheDocument();
  });

  it('empty state "Sin siniestros reportados" cuando events=[]', () => {
    render(<InsuredEventosTab events={[]} />);
    expect(screen.getByText(/sin siniestros reportados/i)).toBeInTheDocument();
  });
});

describe('<InsuredCertificadosTab />', () => {
  it('renderiza tabla con certificados', () => {
    render(<InsuredCertificadosTab certificates={FIXTURE.certificates} />);
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('issued')).toBeInTheDocument();
  });

  it('empty state cuando certificates=[]', () => {
    render(<InsuredCertificadosTab certificates={[]} />);
    expect(screen.getByText(/sin certificados emitidos/i)).toBeInTheDocument();
  });

  it('botón "Reemitir certificado" siempre visible', () => {
    render(<InsuredCertificadosTab certificates={[]} />);
    expect(screen.getByTestId('cert-reissue-btn')).toBeInTheDocument();
  });
});

describe('<InsuredAuditoriaTab />', () => {
  it('renderiza timeline con avatar + acción humanizada + IP enmascarada', () => {
    render(<InsuredAuditoriaTab audit={FIXTURE.audit} insuredId={FIXTURE.insured.id} />);
    expect(screen.getByTestId('audit-timeline')).toBeInTheDocument();
    expect(screen.getByText(/op@mac\.local/)).toBeInTheDocument();
    expect(screen.getByText(/Vió la ficha 360/)).toBeInTheDocument();
    // IPv4 enmascarada: 189.10.20.* (last octet redacted).
    expect(screen.getByText(/189\.10\.20\.\*/)).toBeInTheDocument();
  });

  it('expande/oculta el JSON diff al hacer click en "Ver diff"', async () => {
    const user = userEvent.setup();
    render(<InsuredAuditoriaTab audit={FIXTURE.audit} insuredId={FIXTURE.insured.id} />);
    const btn = screen.getByRole('button', { name: /ver diff/i });
    await user.click(btn);
    expect(screen.getByText(/viewed_360/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ocultar diff/i }));
    expect(screen.queryByText(/"subAction"/)).toBeNull();
  });

  it('empty state "Sin actividad registrada" cuando audit=[]', () => {
    render(<InsuredAuditoriaTab audit={[]} insuredId={FIXTURE.insured.id} />);
    expect(screen.getByText(/sin actividad registrada/i)).toBeInTheDocument();
  });

  it('muestra link de export CSV con el resourceId correcto', () => {
    render(<InsuredAuditoriaTab audit={FIXTURE.audit} insuredId={FIXTURE.insured.id} />);
    const link = screen.getByTestId('audit-export-link');
    expect(link.getAttribute('href')).toContain(`resourceId=${FIXTURE.insured.id}`);
    expect(link.getAttribute('href')).toContain('format=csv');
  });
});
