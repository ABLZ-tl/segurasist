/**
 * H-28 — Tests para hooks `dashboard` (S2-05) y `packages`.
 *
 * Combinados en un solo archivo porque cada hook tiene un único path
 * happy-path; agrupar reduce overhead de bootstrap.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDashboard } from '../src/hooks/dashboard';
import { usePackages, usePackage, useUpsertPackage } from '../src/hooks/packages';
import {
  fetchCalls,
  jsonResponse,
  makeWrapper,
  restoreFetch,
  setupFetchMock,
} from './helpers';

afterEach(() => restoreFetch());

describe('dashboard hook (H-28)', () => {
  it('useDashboard → GET /v1/reports/dashboard', async () => {
    setupFetchMock(() =>
      jsonResponse({
        kpis: {
          activeInsureds: { value: 10, trend: 5 },
          certificates30d: { value: 3, trend: 2 },
          claims30d: { value: 1, trend: 0 },
          coverageConsumedPct: { value: 50, trend: 1 },
        },
        volumetry: [],
        recentBatches: [],
        recentCertificates: [],
        generatedAt: '2026-04-27T10:00:00.000Z',
      }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDashboard(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/reports/dashboard');
  });
});

describe('packages hooks (H-28)', () => {
  it('usePackages → GET /v1/packages', async () => {
    setupFetchMock(() => jsonResponse([]));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePackages(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/packages');
  });

  it('usePackage(id) → GET /v1/packages/:id', async () => {
    setupFetchMock(() => jsonResponse({ id: 'p-1', name: 'Básico' }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePackage('p-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/packages/p-1');
  });

  it('useUpsertPackage → POST /v1/packages cuando no hay id', async () => {
    setupFetchMock(() => jsonResponse({ id: 'p-new', name: 'Premium' }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpsertPackage(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name: 'Premium' });
    });
    expect(fetchCalls[0].method).toBe('POST');
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/packages');
  });

  it('useUpsertPackage → PATCH /v1/packages/:id cuando hay id', async () => {
    setupFetchMock(() => jsonResponse({ id: 'p-1', name: 'Updated' }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpsertPackage(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'p-1', name: 'Updated' });
    });
    expect(fetchCalls[0].method).toBe('PATCH');
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/packages/p-1');
  });
});
