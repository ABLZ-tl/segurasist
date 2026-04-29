'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTenantBranding } from '../../lib/hooks/use-tenant-branding';

/**
 * Branded footer institucional — pie discreto con tagline tenant + año +
 * links a páginas de transparencia (Aviso de privacidad, Términos).
 *
 * Mobile-first: el portal usa `<PortalBottomNav>` fijo abajo, así que este
 * footer se renderiza ARRIBA del bottom-nav (no es nav, es contenido).
 * Padding bottom generoso (`pb-6`) para que no quede pegado al borde y
 * respiro visual del nav.
 */
export function BrandedFooter(): JSX.Element {
  const { displayName, tagline } = useTenantBranding();
  const year = new Date().getFullYear();

  return (
    <footer
      className="px-4 pb-6 pt-8 text-center"
      data-testid="portal-branded-footer"
    >
      {tagline && (
        <p
          className="mb-3 text-xs italic text-fg-muted"
          data-testid="branded-tagline"
        >
          {tagline}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
        <span>
          &copy; {year} {displayName}
        </span>
        <Link
          href={'/legal/privacy' as never}
          className="rounded-sm hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Aviso de privacidad
        </Link>
        <Link
          href={'/legal/terms' as never}
          className="rounded-sm hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Términos
        </Link>
      </div>
    </footer>
  );
}
