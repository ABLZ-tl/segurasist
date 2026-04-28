/**
 * H-28 — Tests para hooks de `claims` (portal asegurado).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCreateClaimSelf } from '../src/hooks/claims';
import {
  fetchCalls,
  jsonResponse,
  makeWrapper,
  restoreFetch,
  setupFetchMock,
  problemResponse,
} from './helpers';

afterEach(() => restoreFetch());

describe('claims hooks (H-28)', () => {
  it('useCreateClaimSelf → POST /v1/claims con body JSON', async () => {
    const dto = {
      type: 'medical' as const,
      occurredAt: '2026-04-20',
      description: 'Consulta urgente',
    };
    const expected = {
      id: 'cl-1',
      ticketNumber: 'MAC-2026-1',
      status: 'received',
      reportedAt: '2026-04-20T10:00:00.000Z',
    };
    setupFetchMock(() => jsonResponse(expected));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateClaimSelf(), { wrapper: Wrapper });
    await act(async () => {
      const r = await result.current.mutateAsync(dto);
      expect(r).toEqual(expected);
    });
    expect(fetchCalls[0].method).toBe('POST');
    expect(fetchCalls[0].url).toBe('/api/proxy/v1/claims');
    expect(JSON.parse(fetchCalls[0].body ?? '{}')).toEqual(dto);
  });

  it('useCreateClaimSelf → backend 422 → mutation falla', async () => {
    setupFetchMock(() => problemResponse(422, 'occurredAt fuera de rango'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateClaimSelf(), { wrapper: Wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          type: 'medical',
          occurredAt: '2999-01-01',
          description: 'x',
        }),
      ).rejects.toThrow();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
