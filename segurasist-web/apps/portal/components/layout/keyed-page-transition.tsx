'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { PageTransition } from '@segurasist/ui';

/**
 * Pequeño wrapper cliente que toma `usePathname()` y lo pasa como `routeKey`
 * al `<PageTransition>` de DS-1. Existe porque `app/(app)/layout.tsx` es un
 * Server Component (consume `cookies()` para `getInsuredFirstName`), y
 * `usePathname` requiere browser. Mantener el wrapper aquí permite que el
 * server layout no quede `'use client'` por el solo hecho de animar.
 */
export interface KeyedPageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

export function KeyedPageTransition({
  children,
  className,
}: KeyedPageTransitionProps): JSX.Element {
  const pathname = usePathname() ?? '/';
  return (
    <PageTransition routeKey={pathname} className={className}>
      {children}
    </PageTransition>
  );
}
