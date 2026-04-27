'use client';

import * as React from 'react';
import Link from 'next/link';
import { ThemeToggle } from './theme-toggle';

export interface PortalHeaderProps {
  /** Friendly first name for the greeting. Falls back to "Hola" if absent. */
  firstName?: string | null;
}

/**
 * Sticky top header for the asegurado portal.
 *
 * - Translucent backdrop blur (`bg-bg/80 backdrop-blur-md`) so content can
 *   scroll beneath without losing legibility.
 * - Respects iOS safe-area-inset-top via inline padding.
 * - Greeting on the left ("Hola, {firstName}") + theme toggle on the right.
 *
 * The greeting only renders when `firstName` is non-empty so we never show
 * an awkward "Hola, " comma stub for users with no name claim.
 */
export function PortalHeader({ firstName }: PortalHeaderProps): JSX.Element {
  const trimmed = (firstName ?? '').trim();
  const hasName = trimmed.length > 0;

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-md"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 0.5rem)',
        paddingBottom: '0.5rem',
        minHeight: '56px',
      }}
      data-testid="portal-header"
    >
      <Link
        href="/"
        className="flex min-h-[44px] items-center gap-2 text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <span className="grid h-8 w-8 place-items-center rounded-md bg-fg text-bg">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            aria-hidden
          >
            <path d="M5 12l4 4L19 6" />
          </svg>
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
            Hospitales MAC
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-fg">
            {hasName ? `Hola, ${trimmed}` : 'Mi Membresía'}
          </span>
        </span>
      </Link>

      <ThemeToggle />
    </header>
  );
}
