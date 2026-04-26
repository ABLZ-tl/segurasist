import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@segurasist/api-client/hooks/dashboard', () => ({
  useDashboard: vi.fn(),
}));

import { useDashboard } from '@segurasist/api-client/hooks/dashboard';
import { DashboardClient } from '../../../app/(app)/dashboard/dashboard-client';

const mockedUseDashboard = vi.mocked(useDashboard);

describe('<DashboardClient />', () => {
  it('renders skeleton placeholders while loading', () => {
    mockedUseDashboard.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    } as never);
    render(<DashboardClient />);
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
  });

  it('renders error banner when the query fails', () => {
    mockedUseDashboard.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Bad gateway'),
    } as never);
    render(<DashboardClient />);
    expect(screen.getByText(/no pudimos cargar el resumen/i)).toBeInTheDocument();
  });

  it('renders empty state when KPIs are all zero and no batches', () => {
    mockedUseDashboard.mockReturnValue({
      data: {
        kpis: {
          activeInsureds: { value: 0, trend: 0 },
          certificates30d: { value: 0, trend: 0 },
          claims30d: { value: 0, trend: 0 },
          coverageConsumedPct: { value: 0, trend: 0 },
        },
        volumetry: [],
        recentBatches: [],
        recentCertificates: [],
        generatedAt: '2026-04-25T00:00:00.000Z',
      },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    render(<DashboardClient />);
    expect(screen.getByText(/aún no hay datos/i)).toBeInTheDocument();
  });

  it('renders KPI grid with formatted values', () => {
    mockedUseDashboard.mockReturnValue({
      data: {
        kpis: {
          activeInsureds: { value: 12480, trend: 4.2 },
          certificates30d: { value: 1920, trend: -1.8 },
          claims30d: { value: 312, trend: 0.6 },
          coverageConsumedPct: { value: 48, trend: 2.1 },
        },
        volumetry: Array.from({ length: 12 }).map((_, i) => ({
          week: `2026-W${String(i + 1).padStart(2, '0')}`,
          altas: 10,
          bajas: 2,
          certs: 5,
        })),
        recentBatches: [],
        recentCertificates: [],
        generatedAt: '2026-04-25T00:00:00.000Z',
      },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    render(<DashboardClient />);
    expect(screen.getByText('12,480')).toBeInTheDocument();
    expect(screen.getByText('1,920')).toBeInTheDocument();
    expect(screen.getByText('48%')).toBeInTheDocument();
  });

  it('shows "Aún no hay lotes" when recentBatches is empty', () => {
    mockedUseDashboard.mockReturnValue({
      data: {
        kpis: {
          activeInsureds: { value: 5, trend: 0 },
          certificates30d: { value: 0, trend: 0 },
          claims30d: { value: 0, trend: 0 },
          coverageConsumedPct: { value: 0, trend: 0 },
        },
        volumetry: Array.from({ length: 12 }).map(() => ({
          week: '2026-W01',
          altas: 0,
          bajas: 0,
          certs: 0,
        })),
        recentBatches: [],
        recentCertificates: [],
        generatedAt: '2026-04-25T00:00:00.000Z',
      },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    render(<DashboardClient />);
    expect(screen.getByText(/aún no hay lotes/i)).toBeInTheDocument();
  });
});
