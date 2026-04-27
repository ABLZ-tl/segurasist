/**
 * Wrapper para tests que necesitan TanStack Query. Cada test arma su propio
 * `QueryClient` con `retry: false` para que las mutations rechazadas se
 * propaguen sin esperar reintentos. `gcTime: 0` evita compartir caché entre
 * tests.
 */

import * as React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function renderWithQuery(
  ui: React.ReactElement,
  options?: RenderOptions & { client?: QueryClient },
) {
  const client = options?.client ?? makeQueryClient();
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
      options,
    ),
  };
}
