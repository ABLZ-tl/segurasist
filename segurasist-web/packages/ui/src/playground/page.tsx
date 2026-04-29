'use client';

/**
 * UI Playground (Sprint 5 — DS-1).
 *
 * Surface for the new Lordicon + GSAP primitives + brandable theming.
 * Mounted by admin under `/dev/ui-playground` behind a `IS_DEV` env gate
 * so it never ships to production. Iter 1 keeps the catalogue stub minimal;
 * iter 2 will resolve the remaining `<TODO_ID_*>` icons and wire variants.
 */

import * as React from 'react';
import { LordIcon, listUnresolvedIcons, LORD_ICON_CATALOG, type LordIconName } from '../lord-icon';
import { GsapFade, GsapStagger, GsapHover, PageTransition } from '../animations';
import { applyBrandableTheme, clearBrandableTheme } from '../theme';

const KNOWN_NAMES = Object.keys(LORD_ICON_CATALOG) as LordIconName[];

export interface UiPlaygroundPageProps {
  enabled?: boolean;
}

/**
 * Entry component for the playground. Returns `null` when `enabled === false`
 * so the host route can render `notFound()` in production.
 */
export function UiPlaygroundPage({ enabled = true }: UiPlaygroundPageProps): JSX.Element | null {
  const [primary, setPrimary] = React.useState('#16a34a');
  const [accent, setAccent] = React.useState('#7c3aed');
  const unresolved = listUnresolvedIcons();

  if (!enabled) return null;

  return (
    <PageTransition routeKey="ui-playground" className="p-8 space-y-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tightest">UI Playground · Sprint 5 DS-1</h1>
        <p className="text-fg-muted">
          Lordicons, GSAP primitives y brandable theming. Solo dev — gated por <code>IS_DEV</code>.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Brandable theme</h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            primary
            <input
              type="color"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            accent
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-md px-3 py-2 bg-tenant-primary text-tenant-primary-fg"
            onClick={() => applyBrandableTheme({ primaryHex: primary, accentHex: accent })}
          >
            Apply
          </button>
          <button
            type="button"
            className="rounded-md px-3 py-2 border border-border"
            onClick={clearBrandableTheme}
          >
            Reset
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">GSAP primitives</h2>
        <GsapFade>
          <p className="text-fg-muted">GsapFade fades + slides this up on mount.</p>
        </GsapFade>
        <GsapStagger className="grid grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-md border border-border p-4 text-center">
              card {i}
            </div>
          ))}
        </GsapStagger>
        <GsapHover>
          <button type="button" className="rounded-md px-4 py-2 bg-accent text-accent-fg">
            Hover me
          </button>
        </GsapHover>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Lordicons catalogue</h2>
        <p className="text-fg-muted text-sm">
          Resolved: {KNOWN_NAMES.length - unresolved.length}/{KNOWN_NAMES.length}.
          Pending iter 2: {unresolved.length} (<code>&lt;TODO_ID_*&gt;</code> markers).
        </p>
        <div className="grid grid-cols-6 gap-4">
          {KNOWN_NAMES.map((name) => (
            <div
              key={name}
              className="flex flex-col items-center gap-2 rounded-md border border-border p-3"
            >
              <LordIcon
                name={name}
                size={48}
                trigger="hover"
                colors={{ primary, secondary: accent }}
                ariaLabel={name}
              />
              <code className="text-xs text-fg-muted">{name}</code>
            </div>
          ))}
        </div>
      </section>
    </PageTransition>
  );
}
