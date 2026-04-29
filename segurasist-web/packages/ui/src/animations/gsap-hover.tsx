'use client';

import * as React from 'react';
import { gsap, usePrefersReducedMotion } from './use-gsap';

export interface GsapHoverProps {
  scale?: number;
  duration?: number;
  ease?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Lightweight hover micro-interaction. Wraps children in a div that scales
 * on pointer enter / leave. Skipped entirely when the user prefers reduced
 * motion. Pointer events are delegated so the wrapper does not interfere
 * with focus rings on the inner element.
 */
export function GsapHover({
  scale = 1.05,
  duration = 0.2,
  ease = 'power2.out',
  className,
  children,
}: GsapHoverProps): JSX.Element {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const prefersReduced = usePrefersReducedMotion();

  // CC-09: Hover is a passive primitive (no entrance animation), so we
  // mark `data-motion-ready` immediately on mount. When reduced-motion is on
  // we additionally skip the per-event tween. Tests can rely on this exactly
  // like the entrance primitives.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute('data-motion-ready', 'true');
  }, []);

  const handleEnter = React.useCallback(() => {
    const el = ref.current;
    if (!el || prefersReduced) return;
    el.setAttribute('data-motion-ready', 'false');
    gsap.to(el, {
      scale,
      duration,
      ease,
      onComplete: () => {
        el.setAttribute('data-motion-ready', 'true');
      },
    });
  }, [scale, duration, ease, prefersReduced]);

  const handleLeave = React.useCallback(() => {
    const el = ref.current;
    if (!el || prefersReduced) return;
    el.setAttribute('data-motion-ready', 'false');
    gsap.to(el, {
      scale: 1,
      duration,
      ease,
      onComplete: () => {
        el.setAttribute('data-motion-ready', 'true');
      },
    });
  }, [duration, ease, prefersReduced]);

  return (
    <span
      ref={ref}
      className={className}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      data-gsap-hover="true"
      data-motion-ready="false"
      style={{ display: 'inline-block', willChange: 'transform' }}
    >
      {children}
    </span>
  );
}
