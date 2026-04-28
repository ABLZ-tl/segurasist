/**
 * S4-01/02/03 — Tests integration páginas de Reports.
 *
 * Cubre:
 *  - `<ReportFilters />` valida from <= to.
 *  - `<ReportDownloadButtons />` con click PDF dispara `useDownloadReport`
 *    con `format='pdf'`; click XLSX con `format='xlsx'`.
 *  - `<VolumetriaChart />` renderiza skeleton → datos → chart con role=img.
 *  - `<UtilizacionChart />` renderiza skeleton → empty cuando rows=0.
 *  - Página `/reports/conciliacion` muestra preview + botones download.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

vi.mock('@segurasist/api-client/hooks/reports', () => ({
  useConciliacionReport: vi.fn(),
  useVolumetria: vi.fn(),
  useUtilizacion: vi.fn(),
  useDownloadReport: vi.fn(),
}));

vi.mock('@segurasist/api-client/hooks/packages', () => ({
  usePackages: vi.fn(() => ({ data: [] })),
}));

import {
  useConciliacionReport,
  useVolumetria,
  useUtilizacion,
  useDownloadReport,
} from '@segurasist/api-client/hooks/reports';

import {
  ReportFilters,
  defaultReportFilters,
  isFilterValid,
  ReportDownloadButtons,
  VolumetriaChart,
  UtilizacionChart,
} from '../../components/reports';

const mockedUseConciliacion = vi.mocked(useConciliacionReport);
const mockedUseVolumetria = vi.mocked(useVolumetria);
const mockedUseUtilizacion = vi.mocked(useUtilizacion);
const mockedUseDownload = vi.mocked(useDownloadReport);

function renderWithClient(ui: React.ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    React.createElement(QueryClientProvider, { client }, ui),
  );
}

describe('isFilterValid (S4-01)', () => {
  it('rechaza from o to vacío', () => {
    expect(isFilterValid({ from: '', to: '2026-04-30' })).toBe(false);
    expect(isFilterValid({ from: '2026-04-01', to: '' })).toBe(false);
  });
  it('rechaza from > to', () => {
    expect(isFilterValid({ from: '2026-05-10', to: '2026-04-30' })).toBe(false);
  });
  it('acepta from === to y from < to', () => {
    expect(isFilterValid({ from: '2026-04-01', to: '2026-04-01' })).toBe(true);
    expect(isFilterValid({ from: '2026-04-01', to: '2026-04-30' })).toBe(true);
  });
});

describe('defaultReportFilters', () => {
  it('default = últimos 30 días (29 días atrás + hoy)', () => {
    const ref = new Date('2026-04-30T12:00:00Z');
    const f = defaultReportFilters(ref);
    expect(f.to).toBe('2026-04-30');
    expect(f.from).toBe('2026-04-01');
  });
});

describe('<ReportFilters />', () => {
  it('muestra error inline si from > to', () => {
    const onChange = vi.fn();
    render(
      React.createElement(ReportFilters, {
        value: { from: '2026-05-10', to: '2026-04-30' },
        onChange,
      }),
    );
    expect(screen.getByTestId('report-filters-error')).toBeInTheDocument();
  });

  it('NO muestra error con rango válido', () => {
    render(
      React.createElement(ReportFilters, {
        value: { from: '2026-04-01', to: '2026-04-30' },
        onChange: vi.fn(),
      }),
    );
    expect(screen.queryByTestId('report-filters-error')).toBeNull();
  });
});

describe('<ReportDownloadButtons /> (S4-01)', () => {
  beforeEach(() => {
    mockedUseDownload.mockReset();
  });

  it('click PDF → mutate({type, format=pdf, filters})', () => {
    const mutate = vi.fn();
    mockedUseDownload.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      error: null,
    } as never);

    renderWithClient(
      React.createElement(ReportDownloadButtons, {
        type: 'conciliacion',
        filters: { from: '2026-04-01', to: '2026-04-30' },
        filenameBase: 'conciliacion-abril',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /pdf/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'conciliacion',
        format: 'pdf',
        filters: { from: '2026-04-01', to: '2026-04-30' },
        filename: 'conciliacion-abril.pdf',
      }),
    );
  });

  it('click XLSX → mutate({type, format=xlsx})', () => {
    const mutate = vi.fn();
    mockedUseDownload.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      error: null,
    } as never);

    renderWithClient(
      React.createElement(ReportDownloadButtons, {
        type: 'volumetria',
        filters: { days: 90 },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /xlsx/i }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'volumetria', format: 'xlsx', filters: { days: 90 } }),
    );
  });

  it('disabled=true → ambos botones no disparan mutate', () => {
    const mutate = vi.fn();
    mockedUseDownload.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      error: null,
    } as never);

    renderWithClient(
      React.createElement(ReportDownloadButtons, {
        type: 'conciliacion',
        disabled: true,
      }),
    );

    const pdf = screen.getByRole('button', { name: /pdf/i });
    const xlsx = screen.getByRole('button', { name: /xlsx/i });
    expect(pdf).toBeDisabled();
    expect(xlsx).toBeDisabled();
    fireEvent.click(pdf);
    fireEvent.click(xlsx);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('isError → muestra alerta', () => {
    mockedUseDownload.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('boom'),
    } as never);

    renderWithClient(
      React.createElement(ReportDownloadButtons, { type: 'conciliacion' }),
    );

    expect(screen.getByTestId('report-download-error')).toBeInTheDocument();
  });

  it('isPending → botón PDF deshabilitado y aria-busy', () => {
    mockedUseDownload.mockReturnValueOnce({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
      error: null,
    } as never);
    mockedUseDownload.mockReturnValueOnce({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    } as never);

    renderWithClient(
      React.createElement(ReportDownloadButtons, { type: 'conciliacion' }),
    );

    const pdf = screen.getByRole('button', { name: /pdf/i });
    expect(pdf).toBeDisabled();
    expect(pdf.getAttribute('aria-busy')).toBe('true');
  });
});

describe('<VolumetriaChart /> (S4-02)', () => {
  beforeEach(() => mockedUseVolumetria.mockReset());

  it('isLoading → skeleton', () => {
    mockedUseVolumetria.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    } as never);
    render(React.createElement(VolumetriaChart, { days: 90 }));
    expect(screen.getByTestId('volumetria-skeleton')).toBeInTheDocument();
  });

  it('isError → AlertBanner', () => {
    mockedUseVolumetria.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Bad gateway'),
    } as never);
    render(React.createElement(VolumetriaChart, { days: 90 }));
    expect(screen.getByText(/no pudimos cargar la volumetría/i)).toBeInTheDocument();
  });

  it('points vacío → empty state', () => {
    mockedUseVolumetria.mockReturnValue({
      data: { days: 90, points: [] },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    render(React.createElement(VolumetriaChart, { days: 90 }));
    expect(screen.getByText(/sin datos/i)).toBeInTheDocument();
  });

  it('con datos → renderiza chart con role=img y aria-label', () => {
    mockedUseVolumetria.mockReturnValue({
      data: {
        days: 90,
        from: '2026-01-01',
        to: '2026-04-01',
        generatedAt: '2026-04-01T00:00:00Z',
        points: [
          { date: '2026-04-01', altas: 5, bajas: 1, certificados: 3, claims: 1 },
          { date: '2026-04-02', altas: 7, bajas: 2, certificados: 6, claims: 0 },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    render(React.createElement(VolumetriaChart, { days: 90 }));
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.getByLabelText(/altas, bajas y certificados/i)).toBeInTheDocument();
  });
});

describe('<UtilizacionChart /> (S4-03)', () => {
  beforeEach(() => {
    mockedUseUtilizacion.mockReset();
  });

  it('rows vacío → empty state', () => {
    mockedUseUtilizacion.mockReturnValue({
      data: {
        from: '2026-04-01',
        to: '2026-04-30',
        topN: 10,
        rows: [],
        byPackage: [],
        generatedAt: '2026-04-30T00:00:00Z',
      },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    render(React.createElement(UtilizacionChart, { from: '2026-04-01', to: '2026-04-30' }));
    expect(screen.getByText(/sin datos/i)).toBeInTheDocument();
  });

  it('rows con datos → renderiza bar chart', () => {
    mockedUseUtilizacion.mockReturnValue({
      data: {
        from: '2026-04-01',
        to: '2026-04-30',
        topN: 10,
        rows: [
          {
            coverageId: 'c1',
            coverageName: 'Consulta médica',
            packageId: 'p1',
            packageName: 'Esencial',
            coverageType: 'count',
            usageCount: 50,
            usageAmount: 80000,
          },
          {
            coverageId: 'c2',
            coverageName: 'Hospitalización',
            packageId: 'p1',
            packageName: 'Esencial',
            coverageType: 'amount',
            usageCount: 5,
            usageAmount: 30000,
          },
        ],
        byPackage: [
          { packageId: 'p1', packageName: 'Esencial', totalUsageCount: 55, totalUsageAmount: 110000 },
        ],
        generatedAt: '2026-04-30T00:00:00Z',
      },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    render(React.createElement(UtilizacionChart, { from: '2026-04-01', to: '2026-04-30' }));
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });
});

describe('Conciliación page integration (S4-01)', () => {
  beforeEach(() => {
    mockedUseConciliacion.mockReset();
    mockedUseDownload.mockReset();
  });

  it('renderiza grid de stats cuando hay datos + botones download presentes', async () => {
    mockedUseConciliacion.mockReturnValue({
      data: {
        from: '2026-04-01',
        to: '2026-04-30',
        tenantId: 't-1',
        activosInicio: 1000,
        activosCierre: 1120,
        altas: 130,
        bajas: 10,
        certificadosEmitidos: 110,
        claimsCount: 3,
        claimsAmountEstimated: 25000,
        claimsAmountApproved: 18000,
        coverageUsageCount: 95,
        coverageUsageAmount: 750000,
        generatedAt: '2026-04-30T12:00:00Z',
      },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    mockedUseDownload.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    } as never);

    const { default: ConciliacionPage } = await import(
      '../../app/(app)/reports/conciliacion/page'
    );
    renderWithClient(React.createElement(ConciliacionPage));

    // Algún stat se renderiza con números formateados (1,000 / 1,120 / 130).
    expect(screen.getByText('1,120')).toBeInTheDocument();
    expect(screen.getByText('130')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /xlsx/i })).toBeInTheDocument();
  });
});
