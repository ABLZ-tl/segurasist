/**
 * H-28 — Tests para hooks de `batches` (admin layouts CSV/XLSX).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useBatches,
  useBatch,
  useUploadBatch,
  useConfirmBatch,
} from '../src/hooks/batches';
import {
  fetchCalls,
  jsonResponse,
  makeWrapper,
  restoreFetch,
  setupFetchMock,
} from './helpers';

afterEach(() => restoreFetch());

describe('batches hooks (H-28)', () => {
  it('useBatches → GET /v1/batches?<qs>', async () => {
    setupFetchMock(() => jsonResponse({ items: [], nextCursor: null }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBatches({ limit: 10 }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toMatch(/^\/api\/proxy\/v1\/batches\?/);
  });

  it('useBatch(id) → GET /v1/batches/:id', async () => {
    setupFetchMock(() =>
      jsonResponse({ id: 'b-1', status: 'completed', rowsTotal: 10, rowsOk: 10, rowsError: 0 }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBatch('b-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/batches/b-1');
  });

  it('useUploadBatch → POST /v1/batches con FormData', async () => {
    setupFetchMock(() => jsonResponse({ id: 'b-new', status: 'validating' }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadBatch(), { wrapper: Wrapper });
    const file = new File(['curp,full_name'], 'sample.csv', { type: 'text/csv' });
    await act(async () => {
      await result.current.mutateAsync(file);
    });
    expect(fetchCalls[0].method).toBe('POST');
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/batches');
  });

  it('useConfirmBatch → POST /v1/batches/:id/confirm', async () => {
    setupFetchMock(() => jsonResponse({ id: 'b-1', status: 'processing' }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConfirmBatch('b-1'), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(fetchCalls[0].method).toBe('POST');
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/batches/b-1/confirm');
  });
});
