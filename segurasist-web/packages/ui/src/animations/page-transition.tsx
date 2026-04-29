'use client';

import * as React from 'react';
import { gsap, usePrefersReducedMotion } from './use-gsap';

export interface PageTransitionProps {
  /**
   * Pathname or route key. The component re-runs the entrance animation each
   * time the key changes. Consumers in Next.js should pass `usePathname()`.
   */
  routeKey: string;
  duration?: number;
  ease?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Page transition primitive. Slides + fades children on every `routeKey`
 * change. Designed to wrap the body of `(app)/layout.tsx` so navigations get
 * a consistent micro-transition. Consumer is responsible for keying
 * (we accept `routeKey` rather than calling `usePathname` here so the package
 * stays Next-agnostic and tree-shakable).
 */
export function PageTransition({
  routeKey,
  duration = 0.25,
  ease = 'power2.out',
  className,
  children,
}: PageTransitionProps): JSX.Element {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const prefersReduced = usePrefersReducedMotion();

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (prefersReduced) {
      gsap.set(el, { opacity: 1, x: 0, clearProps: 'transform' });
      el.setAttribute('data-motion-ready', 'true');
      return undefined;
    }
    el.setAttribute('data-motion-ready', 'false');
    const tween = gsap.fromTo(
      el,
      { opacity: 0, x: 20 },
      {
        opacity: 1,
        x: 0,
        duration,
        ease,
        onComplete: () => {
          el.setAttribute('data-motion-ready', 'true');
        },
      },
    );
    return () => {
      tween.kill();
    };
  }, [routeKey, duration, ease, prefersReduced]);

  return (
    <div
      ref={ref}
      className={className}
      data-page-transition="true"
      data-route-key={routeKey}
      data-motion-ready="false"
    >
      {children}
    </div>
  );
}
