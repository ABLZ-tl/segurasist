/**
 * S4-01/02/03 — Tests para hooks de reports.
 *
 * Cubrimos:
 *   - useConciliacionReport(filters)  → GET /v1/reports/conciliacion?from=&to=&entityId=
 *   - useVolumetria(days)             → GET /v1/reports/volumetria?days=90
 *   - useUtilizacion(filters)         → GET /v1/reports/utilizacion?packageId=&topN=
 *   - downloadReportBlob({type,format,filters})  → GET /v1/reports/<type>?<qs>&format=<fmt>
 *   - useDownloadReport mutation      → invoca downloadReportBlob con params
 *   - filename default + filename override en download
 *   - useConciliacionReport con from/to vacío → no fetch (enabled false)
 *   - error path: response !ok → mutation rejects
 */
import { describe, expect, it, afterEach, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useConciliacionReport,
  useVolumetria,
  useUtilizacion,
  useDownloadReport,
  downloadReportBlob,
} from '../src/hooks/reports';
import {
  fetchCalls,
  jsonResponse,
  makeWrapper,
  restoreFetch,
  setupFetchMock,
} from './helpers';

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

describe('reports hooks (S4-01/02/03)', () => {
  it('useConciliacionReport → GET /v1/reports/conciliacion?<qs>', async () => {
    setupFetchMock(() =>
      jsonResponse({
        from: '2026-04-01',
        to: '2026-04-30',
        tenantId: 't-1',
        activosInicio: 0,
        activosCierre: 0,
        altas: 0,
        bajas: 0,
        certificadosEmitidos: 0,
        claimsCount: 0,
        claimsAmountEstimated: 0,
        claimsAmountApproved: 0,
        coverageUsageCount: 0,
        coverageUsageAmount: 0,
        generatedAt: '',
      }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useConciliacionReport({ from: '2026-04-01', to: '2026-04-30', tenantId: 't-1' }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].method).toBe('GET');
    expect(fetchCalls[0].url).toMatch(/^\/api\/proxy\/v1\/reports\/conciliacion\?/);
    expect(fetchCalls[0].url).toContain('from=2026-04-01');
    expect(fetchCalls[0].url).toContain('to=2026-04-30');
    expect(fetchCalls[0].url).toContain('tenantId=t-1');
  });

  it('useConciliacionReport con from o to vacío → no fetch (enabled=false)', async () => {
    setupFetchMock(() => jsonResponse({}));
    const { Wrapper } = makeWrapper();
    renderHook(() => useConciliacionReport({ from: '', to: '2026-04-30' }), { wrapper: Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchCalls).toHaveLength(0);
  });

  it('useVolumetria(90) → GET /v1/reports/volumetria?days=90', async () => {
    setupFetchMock(() => jsonResponse({ days: 90, points: [] }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVolumetria(90), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].method).toBe('GET');
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/reports/volumetria?days=90');
  });

  it('useVolumetria() → default 90 días', async () => {
    setupFetchMock(() => jsonResponse({ days: 90, points: [] }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useVolumetria(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toContain('days=90');
  });

  it('useUtilizacion → GET /v1/reports/utilizacion?<qs>', async () => {
    setupFetchMock(() =>
      jsonResponse({ from: '', to: '', topN: 10, rows: [], byPackage: [], generatedAt: '' }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useUtilizacion({ from: '2026-04-01', to: '2026-04-30', topN: 5 }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toMatch(/^\/api\/proxy\/v1\/reports\/utilizacion\?/);
    expect(fetchCalls[0].url).toContain('from=2026-04-01');
    expect(fetchCalls[0].url).toContain('to=2026-04-30');
    expect(fetchCalls[0].url).toContain('topN=5');
  });

  it('useUtilizacion sin from/to → no fetch', async () => {
    setupFetchMock(() => jsonResponse({}));
    const { Wrapper } = makeWrapper();
    renderHook(() => useUtilizacion({ from: '', to: '' }), { wrapper: Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchCalls).toHaveLength(0);
  });
});

describe('downloadReportBlob (S4-01)', () => {
  // jsdom no implementa createObjectURL/revokeObjectURL; mockeamos.
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:mock-url'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  it('GET /v1/reports/<type>?<qs>&format=<fmt> + click <a> con download attribute', async () => {
    setupFetchMock(() => new Response(new Blob(['%PDF-1.4...']), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadReportBlob({
      type: 'conciliacion',
      format: 'pdf',
      filters: { from: '2026-04-01', to: '2026-04-30' },
      filename: 'reporte-abril.pdf',
    });

    expect(fetchCalls[0].method).toBe('GET');
    expect(fetchCalls[0].url).toMatch(/^\/api\/proxy\/v1\/reports\/conciliacion\?/);
    expect(fetchCalls[0].url).toContain('format=pdf');
    expect(fetchCalls[0].url).toContain('from=2026-04-01');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('formato xlsx → Accept header xlsx + format=xlsx', async () => {
    setupFetchMock(() => new Response(new Blob(['PK...']), { status: 200 }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadReportBlob({ type: 'utilizacion', format: 'xlsx' });

    expect(fetchCalls[0].url).toContain('format=xlsx');
    expect(fetchCalls[0].headers.accept).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('filename default contiene tipo + fecha + extensión', async () => {
    setupFetchMock(() => new Response(new Blob(['data']), { status: 200 }));
    let captured: string | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      captured = this.getAttribute('download');
    });

    await downloadReportBlob({ type: 'volumetria', format: 'xlsx' });

    expect(captured).not.toBeNull();
    expect(captured).toMatch(/^volumetria-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('response !ok → throw', async () => {
    setupFetchMock(() => new Response('error', { status: 500 }));
    await expect(
      downloadReportBlob({ type: 'conciliacion', format: 'pdf' }),
    ).rejects.toThrow(/download-failed:500/);
  });

  it('useDownloadReport mutation invoca downloadReportBlob con params', async () => {
    setupFetchMock(() => new Response(new Blob(['data']), { status: 200 }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDownloadReport(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        type: 'conciliacion',
        format: 'pdf',
        filters: { from: '2026-04-01' },
      });
    });

    expect(fetchCalls[0].url).toContain('/v1/reports/conciliacion');
    expect(fetchCalls[0].url).toContain('format=pdf');
    expect(fetchCalls[0].url).toContain('from=2026-04-01');
  });
});
