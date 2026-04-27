/**
 * Tests unit Coverages portal — cubre lista, color de barra (success/warning/
 * danger), empty state y formato MXN para `type: 'amount'`.
 */

/**
 * framer-motion / next/* mocks viven en vitest.setup.ts. Aquí solo el hook.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CoverageSelf } from '@segurasist/api-client/hooks/insureds';

vi.mock('@segurasist/api-client/hooks/insureds', () => ({
  useCoveragesSelf: vi.fn(),
}));

import CoveragesPage from '@/app/(app)/coverages/page';
import { useCoveragesSelf } from '@segurasist/api-client/hooks/insureds';

const sample: CoverageSelf[] = [
  {
    id: 'cov-low',
    name: 'Consultas médicas',
    type: 'count',
    limit: 10,
    used: 2,
    unit: 'visitas',
    lastUsedAt: null,
  },
  {
    id: 'cov-mid',
    name: 'Estudios',
    type: 'count',
    limit: 10,
    used: 6,
    unit: 'visitas',
    lastUsedAt: null,
  },
  {
    id: 'cov-high',
    name: 'Hospitalización',
    type: 'count',
    limit: 10,
    used: 9,
    unit: 'visitas',
    lastUsedAt: null,
  },
  {
    id: 'cov-mxn',
    name: 'Medicamentos',
    type: 'amount',
    limit: 10000,
    used: 2500,
    unit: 'MXN',
    lastUsedAt: null,
  },
];

function mockHook(value: Partial<ReturnType<typeof useCoveragesSelf>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCoveragesSelf).mockReturnValue(value as any);
}

describe('Portal CoveragesPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renderiza una card por cobertura', () => {
    mockHook({ data: sample, isLoading: false, isError: false, refetch: vi.fn() });
    render(<CoveragesPage />);
    expect(screen.getByTestId('coverages-list')).toBeInTheDocument();
    for (const c of sample) {
      expect(screen.getByTestId(`coverage-card-${c.id}`)).toBeInTheDocument();
    }
  });

  it('color de ProgressBar refleja consumo (success/warning/danger)', () => {
    mockHook({ data: sample, isLoading: false, isError: false, refetch: vi.fn() });
    render(<CoveragesPage />);
    expect(screen.getByTestId('progress-cov-low')).toHaveAttribute(
      'data-tone',
      'success',
    );
    expect(screen.getByTestId('progress-cov-mid')).toHaveAttribute(
      'data-tone',
      'warning',
    );
    expect(screen.getByTestId('progress-cov-high')).toHaveAttribute(
      'data-tone',
      'danger',
    );
  });

  it('empty state cuando la lista llega vacía', () => {
    mockHook({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    render(<CoveragesPage />);
    expect(screen.getByTestId('coverages-empty')).toBeInTheDocument();
    expect(
      screen.getByText(/sin coberturas configuradas/i),
    ).toBeInTheDocument();
  });

  it('amount: formatea remaining como MXN (es-MX)', () => {
    mockHook({ data: [sample[3]!], isLoading: false, isError: false, refetch: vi.fn() });
    render(<CoveragesPage />);
    // 10000 - 2500 = 7500 → "$7,500"
    const card = screen.getByTestId('coverage-card-cov-mxn');
    expect(card.textContent).toMatch(/\$7,500/);
    expect(card.textContent).toMatch(/\$10,000/);
  });
});
