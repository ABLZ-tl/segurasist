/**
 * H-28 (Sprint 4) — Tests para los hooks de `insureds`.
 *
 * Cubrimos los caminos que consume admin Y portal:
 *   - useInsureds(params)         — admin listing con qs
 *   - useInsured(id)              — admin detail
 *   - useInsured360(id)           — admin S3-06
 *   - useInsuredSelf()            — portal /me (H-23)
 *   - useCoveragesSelf()          — portal /me/coverages (H-23)
 *   - useCreateInsured / useUpdateInsured / useDeleteInsured — admin CRUD
 *
 * El gate mínimo: cada hook envía el verbo + path correcto. Si alguien
 * refactoriza una key o cambia un path, el test rompe.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useInsureds,
  useInsured,
  useInsured360,
  useInsuredSelf,
  useCoveragesSelf,
  useCreateInsured,
  useUpdateInsured,
  useDeleteInsured,
} from '../src/hooks/insureds';
import {
  fetchCalls,
  jsonResponse,
  makeWrapper,
  restoreFetch,
  setupFetchMock,
} from './helpers';

afterEach(() => restoreFetch());

describe('insureds hooks (H-28)', () => {
  it('useInsureds → GET /v1/insureds?<qs>', async () => {
    setupFetchMock(() => jsonResponse({ items: [], nextCursor: null }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInsureds({ limit: 20, q: 'maria' }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].method).toBe('GET');
    expect(fetchCalls[0].url).toMatch(/^\/api\/proxy\/v1\/insureds\?/);
    expect(fetchCalls[0].url).toContain('limit=20');
    expect(fetchCalls[0].url).toContain('q=maria');
  });

  it('useInsured(id) → GET /v1/insureds/:id', async () => {
    setupFetchMock(() => jsonResponse({ id: 'i-1', fullName: 'X' }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInsured('i-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/insureds/i-1');
  });

  it('useInsured con id vacío → no fetch (enabled=false)', async () => {
    setupFetchMock(() => jsonResponse({}));
    const { Wrapper } = makeWrapper();
    renderHook(() => useInsured(''), { wrapper: Wrapper });
    // pequeño tick para confirmar que no se dispara fetch
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchCalls).toHaveLength(0);
  });

  it('useInsured360 → GET /v1/insureds/:id/360', async () => {
    setupFetchMock(() => jsonResponse({ insured: { id: 'i-1' }, sections: {} }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInsured360('i-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/insureds/i-1/360');
  });

  it('useInsuredSelf → GET /v1/insureds/me (portal)', async () => {
    setupFetchMock(() => jsonResponse({ id: 'self', fullName: 'María' }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInsuredSelf(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/insureds/me');
  });

  it('useCoveragesSelf → GET /v1/insureds/me/coverages (portal)', async () => {
    setupFetchMock(() => jsonResponse([]));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCoveragesSelf(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/insureds/me/coverages');
  });

  it('useCreateInsured → POST /v1/insureds con body JSON', async () => {
    const dto = {
      curp: 'AAAA800101HDFRRR01',
      fullName: 'X',
      packageId: 'p-1',
      validFrom: '2026-01-01',
      validTo: '2027-01-01',
      dob: '1980-01-01',
    };
    setupFetchMock(() => jsonResponse({ id: 'new-id', ...dto }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateInsured(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync(dto as never);
    });
    expect(fetchCalls[0].method).toBe('POST');
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/insureds');
    expect(JSON.parse(fetchCalls[0].body ?? '{}')).toEqual(dto);
  });

  it('useUpdateInsured → PATCH /v1/insureds/:id con body JSON', async () => {
    setupFetchMock(() => jsonResponse({ id: 'i-1' }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateInsured('i-1'), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ fullName: 'Y' } as never);
    });
    expect(fetchCalls[0].method).toBe('PATCH');
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/insureds/i-1');
    expect(JSON.parse(fetchCalls[0].body ?? '{}')).toEqual({ fullName: 'Y' });
  });

  it('useDeleteInsured → DELETE /v1/insureds/:id', async () => {
    setupFetchMock(() => new Response(null, { status: 204 }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteInsured(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync('i-1');
    });
    expect(fetchCalls[0].method).toBe('DELETE');
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/insureds/i-1');
  });
});
