/**
 * H-28 (Sprint 4) — Helpers compartidos para tests de hooks.
 *
 * Centraliza:
 *  - mock global de `fetch` con captura de calls (URL, method, body, headers).
 *  - factory de `QueryClient` deterministico (retry off, gcTime/staleTime 0).
 *  - wrapper React minimal con `QueryClientProvider`.
 *
 * Por qué no usar MSW: los hooks acá son thin wrappers sobre `fetch`; un
 * mock directo cubre el contrato (path + verbo + body + headers especiales
 * como `x-trace-id`) sin la sobrecarga del service worker. Si en el futuro
 * agregamos transformaciones complejas (interceptors, retries con backoff)
 * migramos a MSW.
 */
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export interface FetchCall {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

export type FetchHandler = (call: FetchCall) => Response | Promise<Response>;

export const fetchCalls: FetchCall[] = [];

const ORIGINAL_FETCH = globalThis.fetch;

export function setupFetchMock(handler: FetchHandler): void {
  fetchCalls.length = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const rawBody = init?.body;
    const body = typeof rawBody === 'string' ? rawBody : undefined;
    const headers = (init?.headers as Record<string, string> | undefined) ?? {};
    const call: FetchCall = { url, method, body, headers };
    fetchCalls.push(call);
    return handler(call);
  }) as typeof fetch;
}

export function restoreFetch(): void {
  globalThis.fetch = ORIGINAL_FETCH;
}

export function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function problemResponse(status: number, detail = 'error'): Response {
  return new Response(
    JSON.stringify({
      type: 'about:blank',
      title: `HTTP ${status}`,
      status,
      detail,
      traceId: 'test-trace',
    }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function makeWrapper(): {
  Wrapper: React.FC<{ children: React.ReactNode }>;
  client: QueryClient;
} {
  const client = makeQueryClient();
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { Wrapper, client };
}
