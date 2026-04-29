'use client';

/**
 * Isomorphic GSAP hook. Returns the GSAP module on the client and `null` on
 * the server / before hydration. Plugins can be registered idempotently.
 *
 * GSAP is intentionally imported at module scope: this file is a client
 * component and Next dead-code-eliminates it from the server bundle. If you
 * need GSAP outside a `'use client'` boundary, wrap the call in `useEffect`
 * and read `typeof window !== 'undefined'` first.
 */

import * as React from 'react';
import gsap from 'gsap';

const registeredPlugins = new WeakSet<object>();

export interface UseGsapOptions {
  /** Plugins to register on the client. Skipped during SSR. */
  plugins?: unknown[];
}

export function useGsap(options: UseGsapOptions = {}): typeof gsap | null {
  const [ready, setReady] = React.useState<boolean>(typeof window !== 'undefined');

  React.useEffect(() => {
    setReady(true);
    if (options.plugins) {
      for (const plugin of options.plugins) {
        if (plugin && typeof plugin === 'object' && !registeredPlugins.has(plugin as object)) {
          gsap.registerPlugin(plugin as gsap.Plugin);
          registeredPlugins.add(plugin as object);
        }
      }
    }
  }, [options.plugins]);

  return ready ? gsap : null;
}

/**
 * Returns `true` when the user prefers reduced motion. SSR-safe (defaults to
 * `false`). Listens for changes via `matchMedia` so a user toggling the OS
 * setting at runtime is honoured immediately.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    // Older Safari fallback
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  return reduced;
}

export { gsap };
