'use client';

import * as React from 'react';

/**
 * S3-07 — Debounce reutilizable. Devuelve `value` después de `delayMs` sin
 * cambios. Usado por la barra de búsqueda de insureds (300 ms recomendados
 * por RF-203).
 *
 * Tests: cubierto en `insureds-list-search.test.tsx` con `vi.useFakeTimers`.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
