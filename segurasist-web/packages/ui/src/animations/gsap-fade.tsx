'use client';

import * as React from 'react';
import { gsap, usePrefersReducedMotion } from './use-gsap';

export interface GsapFadeProps {
  /** Total animation duration in seconds. */
  duration?: number;
  /** Delay before the animation starts, in seconds. */
  delay?: number;
  /** Initial Y offset (px) — children slide up from this distance. */
  y?: number;
  /** Override the easing curve. Defaults to GSAP's `power2.out`. */
  ease?: string;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
  children: React.ReactNode;
}

/**
 * Fades + slides children in on mount. Respects `prefers-reduced-motion`
 * (renders instantly with `gsap.set`). Cleans up on unmount via `kill()`.
 */
export function GsapFade({
  duration = 0.5,
  delay = 0,
  y = 20,
  ease = 'power2.out',
  className,
  as = 'div',
  children,
}: GsapFadeProps): JSX.Element {
  const ref = React.useRef<HTMLElement | null>(null);
  const prefersReduced = usePrefersReducedMotion();

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // CC-09: Reduced-motion → mark ready immediately so Playwright/visual
    // regression suites can deterministically wait for animations to settle.
    if (prefersReduced) {
      gsap.set(el, { opacity: 1, y: 0, clearProps: 'transform' });
      el.setAttribute('data-motion-ready', 'true');
      return undefined;
    }
    el.setAttribute('data-motion-ready', 'false');
    const tween = gsap.fromTo(
      el,
      { opacity: 0, y },
      {
        opacity: 1,
        y: 0,
        duration,
        delay,
        ease,
        onComplete: () => {
          el.setAttribute('data-motion-ready', 'true');
        },
      },
    );
    return () => {
      tween.kill();
    };
  }, [duration, delay, y, ease, prefersReduced]);

  const Tag = as as keyof JSX.IntrinsicElements;
  return React.createElement(
    Tag,
    {
      ref: ref as unknown as React.Ref<unknown>,
      className,
      style: { opacity: 0 },
      'data-gsap-fade': 'true',
      'data-motion-ready': 'false',
    },
    children,
  );
}
