/**
 * H-28 — Tests para hooks de `certificates` (admin + portal).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useCertificates,
  useInsuredCertificates,
  useReissueCertificate,
  useCertificateMine,
} from '../src/hooks/certificates';
import {
  fetchCalls,
  jsonResponse,
  makeWrapper,
  restoreFetch,
  setupFetchMock,
} from './helpers';

afterEach(() => restoreFetch());

describe('certificates hooks (H-28)', () => {
  it('useCertificates → GET /v1/certificates?<qs>', async () => {
    setupFetchMock(() => jsonResponse({ items: [], nextCursor: null }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCertificates({ limit: 5 }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toMatch(/^\/api\/proxy\/v1\/certificates\?/);
  });

  it('useInsuredCertificates → GET /v1/insureds/:id/certificates', async () => {
    setupFetchMock(() => jsonResponse([]));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useInsuredCertificates('i-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/insureds/i-1/certificates');
  });

  it('useReissueCertificate → POST /v1/insureds/:id/certificates/reissue', async () => {
    setupFetchMock(() => jsonResponse({ id: 'cert-2', version: 2 }));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useReissueCertificate(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync('i-1');
    });
    expect(fetchCalls[0].method).toBe('POST');
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/insureds/i-1/certificates/reissue');
  });

  it('useCertificateMine → GET /v1/certificates/mine (portal H-23)', async () => {
    setupFetchMock(() =>
      jsonResponse({
        url: 'https://signed.example/cert.pdf',
        expiresAt: '2026-04-28T10:00:00.000Z',
        certificateId: 'c-1',
        version: 1,
        issuedAt: '2026-01-01T00:00:00.000Z',
        validTo: '2027-01-01T00:00:00.000Z',
      }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCertificateMine(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/certificates/mine');
  });
});
