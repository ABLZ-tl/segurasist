/**
 * H-28 — Tests para hooks de `exports` (S3-09).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRequestExport, useExportStatus } from '../src/hooks/exports';
import {
  fetchCalls,
  jsonResponse,
  makeWrapper,
  restoreFetch,
  setupFetchMock,
} from './helpers';

afterEach(() => restoreFetch());

describe('exports hooks (H-28)', () => {
  it('useRequestExport → POST /v1/insureds/export con body { format, filters }', async () => {
    setupFetchMock(() => jsonResponse({ exportId: 'exp-1', status: 'pending' }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRequestExport(), { wrapper: Wrapper });
    const dto = { format: 'xlsx' as const, filters: { status: 'active' as const } };
    await act(async () => {
      await result.current.mutateAsync(dto);
    });
    expect(fetchCalls[0].method).toBe('POST');
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/insureds/export');
    expect(JSON.parse(fetchCalls[0].body ?? '{}')).toEqual(dto);
  });

  it('useExportStatus(null) → no fetch (enabled=false)', async () => {
    setupFetchMock(() => jsonResponse({}));
    const { Wrapper } = makeWrapper();
    renderHook(() => useExportStatus(null), { wrapper: Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchCalls).toHaveLength(0);
  });

  it('useExportStatus(id) → GET /v1/exports/:id', async () => {
    setupFetchMock(() =>
      jsonResponse({
        exportId: 'exp-1',
        status: 'ready',
        format: 'xlsx',
        rowCount: 50,
        downloadUrl: 'https://s3.local/signed',
        requestedAt: '2026-04-20T10:00:00.000Z',
        completedAt: '2026-04-20T10:00:05.000Z',
      }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useExportStatus('exp-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/exports/exp-1');
    expect(result.current.data?.downloadUrl).toBe('https://s3.local/signed');
  });
});
