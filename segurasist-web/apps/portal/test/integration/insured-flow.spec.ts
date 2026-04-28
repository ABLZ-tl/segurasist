/**
 * H-23 (Sprint 4) — Integration spec del flujo "asegurado" del portal.
 *
 * Cubre los 4 endpoints insured-only que antes NO tenían cobertura E2E ni
 * de proxy:
 *
 *  1. `GET /v1/insureds/me`              — useInsuredSelf
 *  2. `GET /v1/insureds/me/coverages`    — useCoveragesSelf
 *  3. `POST /v1/claims`                  — useCreateClaimSelf
 *  4. `GET /v1/certificates/mine`        — useCertificateMine
 *
 * Estrategia (mocked stack):
 *   - El portal hace fetch a `/api/proxy/<path>` (proxy interno que reenvía
 *     al backend con el Bearer del cookie HttpOnly). Acá mockeamos `fetch`
 *     globalmente para responder con payloads canónicos por endpoint, sin
 *     necesidad de levantar Next + el backend.
 *   - Usamos los hooks reales de `@segurasist/api-client` (no los re-
 *     implementamos): `useInsuredSelf`, `useCoveragesSelf`, `useCertificateMine`,
 *     `useCreateClaimSelf`. Si esos hooks se rompen (refactor de cache key,
 *     paths, etc.), el test rompe.
 *   - Renderizamos cada hook con `renderHook` + `QueryClientProvider`
 *     minimal (mismo helper que el resto del portal usa).
 *
 * Por qué no levantar Next:
 *   - El proxy `/api/proxy/[...path]` ya tiene tests propios (`proxy.spec.ts`)
 *     que cubren forwarding del Bearer. Aquí queremos la otra mitad:
 *     "el cliente es capaz de invocar correctamente cada endpoint, parsear
 *     la respuesta y mantener invariantes (path correcto, verbo correcto,
 *     body en POST)".
 */
import { describe, expect, it, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useInsuredSelf,
  useCoveragesSelf,
} from '../../../../packages/api-client/src/hooks/insureds';
import { useCertificateMine } from '../../../../packages/api-client/src/hooks/certificates';
import { useCreateClaimSelf } from '../../../../packages/api-client/src/hooks/claims';

interface FetchCall {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

const fetchCalls: FetchCall[] = [];
type FetchHandler = (call: FetchCall) => Response | Promise<Response>;

function setupFetchMock(handler: FetchHandler): void {
  fetchCalls.length = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const headers = (init?.headers as Record<string, string> | undefined) ?? {};
    const call: FetchCall = { url, method, body, headers };
    fetchCalls.push(call);
    return handler(call);
  }) as typeof fetch;
}

function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  }
  return { client, Wrapper };
}

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('Portal insured flow — H-23 (mocked stack)', () => {
  describe('useInsuredSelf — GET /v1/insureds/me', () => {
    it('emite GET al path correcto vía /api/proxy y parsea el payload', async () => {
      const payload = {
        id: 'insured-uuid',
        fullName: 'María Insured',
        packageId: 'pkg-1',
        packageName: 'Básico',
        validFrom: '2026-01-01',
        validTo: '2027-01-01',
        status: 'vigente' as const,
        daysUntilExpiry: 200,
        supportPhone: '+52-55-0000-0000',
      };
      setupFetchMock(() => jsonResponse(payload));

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useInsuredSelf(), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(payload);
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.url).toBe('/api/proxy/v1/insureds/me');
      expect(fetchCalls[0]!.method).toBe('GET');
      expect(fetchCalls[0]!.headers['x-trace-id']).toBeDefined();
    });

    it('cuando el backend responde 401 Problem Details, el hook expone isError', async () => {
      setupFetchMock(() =>
        new Response(
          JSON.stringify({
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'session expired',
            traceId: 'tr-1',
          }),
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        ),
      );

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useInsuredSelf(), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useCoveragesSelf — GET /v1/insureds/me/coverages', () => {
    it('emite GET al path correcto y parsea el array de CoverageSelf', async () => {
      const payload = [
        {
          id: 'cov-1',
          name: 'Consultas',
          type: 'count' as const,
          limit: 6,
          used: 2,
          unit: 'visits',
          lastUsedAt: '2026-04-15T10:00:00.000Z',
        },
        {
          id: 'cov-2',
          name: 'Tope farmacia',
          type: 'amount' as const,
          limit: 5000,
          used: 1200,
          unit: 'MXN',
          lastUsedAt: null,
        },
      ];
      setupFetchMock(() => jsonResponse(payload));

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useCoveragesSelf(), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(payload);
      expect(fetchCalls[0]!.url).toBe('/api/proxy/v1/insureds/me/coverages');
      expect(fetchCalls[0]!.method).toBe('GET');
    });
  });

  describe('useCreateClaimSelf — POST /v1/claims', () => {
    it('envía POST al path correcto con body JSON y x-trace-id', async () => {
      const dto = {
        type: 'medical' as const,
        occurredAt: '2026-04-20',
        description: 'Consulta dental urgente',
      };
      const result = {
        id: 'claim-1',
        ticketNumber: 'MAC-2026-000123',
        status: 'received',
        reportedAt: '2026-04-20T10:00:00.000Z',
      };
      setupFetchMock(() => jsonResponse(result));

      const { Wrapper } = makeWrapper();
      const { result: hookResult } = renderHook(() => useCreateClaimSelf(), { wrapper: Wrapper });

      await act(async () => {
        const r = await hookResult.current.mutateAsync(dto);
        expect(r).toEqual(result);
      });

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.url).toBe('/api/proxy/v1/claims');
      expect(fetchCalls[0]!.method).toBe('POST');
      expect(JSON.parse(fetchCalls[0]!.body ?? '{}')).toEqual(dto);
      expect(fetchCalls[0]!.headers['content-type']).toBe('application/json');
      expect(fetchCalls[0]!.headers['x-trace-id']).toBeDefined();
    });

    it('cuando el backend responde 422 (validation), el mutation rechaza', async () => {
      setupFetchMock(() =>
        new Response(
          JSON.stringify({
            type: 'about:blank',
            title: 'Unprocessable',
            status: 422,
            detail: 'occurredAt fuera de rango',
            traceId: 'tr-2',
          }),
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      );
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useCreateClaimSelf(), { wrapper: Wrapper });
      await act(async () => {
        await expect(
          result.current.mutateAsync({
            type: 'medical',
            occurredAt: '2999-01-01',
            description: 'futuro',
          }),
        ).rejects.toThrow();
      });
    });
  });

  describe('useCertificateMine — GET /v1/certificates/mine', () => {
    it('emite GET al path correcto y devuelve URL pre-firmada + expiresAt', async () => {
      const payload = {
        url: 'https://signed.s3.local/certs/abc.pdf?X-Amz-Signature=...',
        expiresAt: '2026-04-28T10:00:00.000Z',
        certificateId: 'cert-1',
        version: 2,
        issuedAt: '2026-01-01T00:00:00.000Z',
        validTo: '2027-01-01T00:00:00.000Z',
      };
      setupFetchMock(() => jsonResponse(payload));

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useCertificateMine(), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(payload);
      expect(fetchCalls[0]!.url).toBe('/api/proxy/v1/certificates/mine');
      expect(fetchCalls[0]!.method).toBe('GET');
    });
  });

  describe('cross-flow regression — E2E secuencial me → coverages → claim → certificate', () => {
    it('el portal puede emitir los 4 endpoints sin colisión de cache key', async () => {
      const responses: Record<string, unknown> = {
        '/api/proxy/v1/insureds/me': {
          id: 'insured-uuid',
          fullName: 'María',
          packageId: 'p1',
          packageName: 'Básico',
          validFrom: '2026-01-01',
          validTo: '2027-01-01',
          status: 'vigente',
          daysUntilExpiry: 100,
          supportPhone: '+52',
        },
        '/api/proxy/v1/insureds/me/coverages': [],
        '/api/proxy/v1/claims': {
          id: 'c1',
          ticketNumber: 'MAC-1',
          status: 'received',
          reportedAt: '2026-04-20T10:00:00.000Z',
        },
        '/api/proxy/v1/certificates/mine': {
          url: 'https://x',
          expiresAt: '2026-04-28T10:00:00.000Z',
          certificateId: 'c1',
          version: 1,
          issuedAt: '2026-01-01T00:00:00.000Z',
          validTo: '2027-01-01T00:00:00.000Z',
        },
      };
      setupFetchMock((call) => {
        const data = responses[call.url];
        if (!data) return new Response('not-found', { status: 404 });
        return jsonResponse(data);
      });

      const { Wrapper, client } = makeWrapper();

      const meHook = renderHook(() => useInsuredSelf(), { wrapper: Wrapper });
      await waitFor(() => expect(meHook.result.current.isSuccess).toBe(true));

      const covHook = renderHook(() => useCoveragesSelf(), { wrapper: Wrapper });
      await waitFor(() => expect(covHook.result.current.isSuccess).toBe(true));

      const claimHook = renderHook(() => useCreateClaimSelf(), { wrapper: Wrapper });
      await act(async () => {
        await claimHook.result.current.mutateAsync({
          type: 'medical',
          occurredAt: '2026-04-20',
          description: 'consulta',
        });
      });

      const certHook = renderHook(() => useCertificateMine(), { wrapper: Wrapper });
      await waitFor(() => expect(certHook.result.current.isSuccess).toBe(true));

      // 4 fetches uniformemente distribuidos por endpoint.
      const urls = fetchCalls.map((c) => c.url);
      expect(urls).toContain('/api/proxy/v1/insureds/me');
      expect(urls).toContain('/api/proxy/v1/insureds/me/coverages');
      expect(urls).toContain('/api/proxy/v1/claims');
      expect(urls).toContain('/api/proxy/v1/certificates/mine');
      expect(urls.filter((u) => u === '/api/proxy/v1/insureds/me')).toHaveLength(1);

      // Cache keys reales:
      expect(client.getQueryData(['insured-self'])).toBeDefined();
      expect(client.getQueryData(['coverages-self'])).toBeDefined();
      expect(client.getQueryData(['certificate-mine'])).toBeDefined();
    });
  });
});
