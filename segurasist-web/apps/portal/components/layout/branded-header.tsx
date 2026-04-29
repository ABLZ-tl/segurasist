'use client';

import * as React from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { LordIcon, GsapFade } from '@segurasist/ui';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import { useTenantBranding } from '../../lib/hooks/use-tenant-branding';

export interface BrandedHeaderProps {
  firstName?: string | null;
  fullName?: string | null;
  email?: string | null;
}

/**
 * Branded header del portal asegurado — toma displayName/logoUrl del
 * `TenantProvider`. Sustituye al `<PortalHeader>` legacy hard-codeado a
 * "Hospitales MAC".
 *
 * Características UI/UX (cliente exigió "no genérica"):
 *  - Shadow soft (`shadow-sm`) en lugar de `border-b 1px` plano.
 *  - Border-radius 12px en el contenedor del logo.
 *  - Si `logoUrl` está disponible: `<img loading="lazy">` con blur-up via
 *    `decoding=async`.
 *  - Si `logoUrl` es null: `<LordIcon name="shield-check">` animado al
 *    primer mount (idle) y al hover (micro-interaction trigger=hover).
 *  - Animación de entrada con `<GsapFade>` (DS-1 wrapper definitivo desde
 *    `@segurasist/ui`, GSAP power2.out 500ms con respeto a `prefers-reduced-motion`).
 *  - Greeting `Hola, X` se preserva (commit bd2c9d2 funcional).
 *  - User menu se mantiene tal cual (UserMenu del header legacy).
 */
export function BrandedHeader({
  firstName,
  fullName,
  email,
}: BrandedHeaderProps): JSX.Element {
  const { displayName, logoUrl, primaryHex, isLoading } = useTenantBranding();
  const trimmedFirst = (firstName ?? '').trim();
  const hasName = trimmedFirst.length > 0;

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-bg/80 px-4 shadow-sm backdrop-blur-md"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 0.5rem)',
        paddingBottom: '0.5rem',
        minHeight: '56px',
      }}
      data-testid="portal-branded-header"
      data-tenant-loading={isLoading || undefined}
    >
      <GsapFade as="div" className="flex items-center gap-2">
        <Link
          href="/"
          aria-label={`${displayName} — inicio`}
          className="flex min-h-[44px] items-center gap-2 rounded-lg text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <span
            className="grid h-9 w-9 place-items-center overflow-hidden rounded-lg"
            style={{
              // CSS var con fallback — el provider la sobreescribe vía
              // setProperty (CSP-safe, no es inline style HTML attribute).
              backgroundColor: 'var(--tenant-primary-hex, #16a34a)',
              color: '#fff',
            }}
            data-testid="branded-logo-slot"
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                width={36}
                height={36}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-contain"
                data-testid="branded-logo-img"
              />
            ) : (
              <LordIcon
                name="shield-check"
                trigger="hover"
                size={28}
                ariaLabel={displayName}
                colors={{ primary: '#ffffff' }}
                // SSR / pre-hydration fallback: Lucide shield blanco con el
                // mismo tamaño que el wrapper del logo (28px). Mantiene el
                // layout estable hasta que el web component se registra.
                fallback={
                  <ShieldCheck
                    aria-hidden
                    style={{ width: 28, height: 28, color: '#ffffff' }}
                  />
                }
              />
            )}
          </span>
          <span className="flex flex-col leading-tight">
            <span
              className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle"
              data-testid="branded-display-name"
            >
              {displayName}
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-fg">
              {hasName ? `Hola, ${trimmedFirst}` : 'Mi Membresía'}
            </span>
          </span>
        </Link>
      </GsapFade>

      <div className="flex items-center gap-1" data-tenant-primary={primaryHex}>
        <ThemeToggle />
        <UserMenu fullName={fullName ?? trimmedFirst} email={email} />
      </div>
    </header>
  );
}
