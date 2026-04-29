'use client';

import * as React from 'react';
import { gsap, usePrefersReducedMotion } from './use-gsap';

export interface GsapStaggerProps {
  staggerDelay?: number;
  duration?: number;
  y?: number;
  ease?: string;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
  children: React.ReactNode;
}

/**
 * Staggers entrance of direct children. Each direct child element is animated
 * via `gsap.from` with the given `staggerDelay`. Children that are React
 * fragments are flattened by the consumer; we only inspect DOM children.
 */
export function GsapStagger({
  staggerDelay = 0.1,
  duration = 0.45,
  y = 20,
  ease = 'power2.out',
  className,
  as = 'div',
  children,
}: GsapStaggerProps): JSX.Element {
  const containerRef = React.useRef<HTMLElement | null>(null);
  const prefersReduced = usePrefersReducedMotion();

  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const targets = Array.from(node.children) as HTMLElement[];
    if (targets.length === 0) {
      // No children → immediately ready (CC-09).
      node.setAttribute('data-motion-ready', 'true');
      return undefined;
    }
    if (prefersReduced) {
      gsap.set(targets, { opacity: 1, y: 0, clearProps: 'transform' });
      node.setAttribute('data-motion-ready', 'true');
      return undefined;
    }
    node.setAttribute('data-motion-ready', 'false');
    const tween = gsap.from(targets, {
      opacity: 0,
      y,
      duration,
      ease,
      stagger: staggerDelay,
      onComplete: () => {
        node.setAttribute('data-motion-ready', 'true');
      },
    });
    return () => {
      tween.kill();
    };
  }, [staggerDelay, duration, y, ease, prefersReduced]);

  const Tag = as as keyof JSX.IntrinsicElements;
  return React.createElement(
    Tag,
    {
      ref: containerRef as unknown as React.Ref<unknown>,
      className,
      'data-gsap-stagger': 'true',
      'data-motion-ready': 'false',
    },
    children,
  );
}
