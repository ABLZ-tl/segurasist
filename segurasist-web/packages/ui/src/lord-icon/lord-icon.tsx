'use client';

/**
 * <LordIcon> — SSR-safe wrapper around the `lord-icon` web component.
 *
 * The web component is registered in the browser only. During SSR (and the
 * first render after hydration) we render a sized placeholder so the layout
 * does not jump and screen readers ignore the decoration. The web component
 * itself is loaded lazily via dynamic import of `lord-icon-element`.
 *
 * Consumed by MT-2 (admin branding editor), MT-3 (portal nav) and S5-3
 * (chatbot KB icons). API contract is locked for Sprint 5 iter 1.
 */

import * as React from 'react';
import { LORD_ICON_CATALOG, type LordIconName, resolveLordIconUrl } from './catalog';

export type LordIconTrigger =
  | 'hover'
  | 'click'
  | 'loop'
  | 'loop-on-hover'
  | 'morph'
  | 'in'
  | 'in-reveal'
  | 'sequence'
  | 'boomerang';

export interface LordIconColors {
  primary: string;
  secondary?: string;
}

export interface LordIconProps {
  /**
   * Friendly catalog name. Either `name` or `src` must be provided. `src`
   * takes precedence so callers can render an icon that is not yet mapped.
   */
  name?: LordIconName;
  /** Direct URL to a Lottie JSON asset (escape hatch for ad-hoc icons). */
  src?: string;
  trigger?: LordIconTrigger;
  colors?: LordIconColors;
  size?: number;
  loop?: boolean;
  delay?: number;
  className?: string;
  /** Accessible label. When omitted the icon is treated as decorative. */
  ariaLabel?: string;
  /**
   * Fallback rendered before hydration / when JS is disabled. Defaults to a
   * hidden, sized <span> so layout stays stable. Pass a Lucide icon when you
   * want a richer no-JS experience.
   */
  fallback?: React.ReactNode;
}

let registerPromise: Promise<void> | null = null;

/**
 * Lazily registers the `lord-icon` custom element. Idempotent. The dynamic
 * import keeps the dependency out of the SSR bundle entirely.
 */
export function registerLordIconElement(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }
  if (window.customElements?.get('lord-icon')) {
    return Promise.resolve();
  }
  if (!registerPromise) {
    registerPromise = import('lord-icon-element')
      .then(async (mod) => {
        const lottieMod = await import('lottie-web');
        const lottie = (lottieMod as { default?: unknown }).default ?? lottieMod;
        if (typeof (mod as { defineElement?: (l: unknown) => void }).defineElement === 'function') {
          (mod as { defineElement: (l: unknown) => void }).defineElement(lottie);
        }
      })
      .catch((err) => {
        // Reset so a future render can retry. Surface in dev so failures are
        // not silent.
        registerPromise = null;
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.error('[LordIcon] failed to register web component', err);
        }
      });
  }
  return registerPromise;
}

function buildColorsAttr(colors?: LordIconColors): string | undefined {
  if (!colors) return undefined;
  const parts = [`primary:${colors.primary}`];
  if (colors.secondary) parts.push(`secondary:${colors.secondary}`);
  return parts.join(',');
}

export function LordIcon({
  name,
  src,
  trigger = 'hover',
  colors,
  size = 32,
  loop = false,
  delay,
  className,
  ariaLabel,
  fallback,
}: LordIconProps): JSX.Element {
  const [registered, setRegistered] = React.useState(false);
  const resolvedSrc = src ?? (name ? resolveLordIconUrl(name) : '');

  React.useEffect(() => {
    let cancelled = false;
    void registerLordIconElement().then(() => {
      if (!cancelled) setRegistered(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dimensions = { width: size, height: size } as const;

  if (!registered) {
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }
    return (
      <span
        aria-hidden={ariaLabel ? undefined : true}
        aria-label={ariaLabel}
        role={ariaLabel ? 'img' : undefined}
        className={className}
        data-lord-icon-fallback="true"
        style={{ display: 'inline-block', ...dimensions }}
      />
    );
  }

  // Use createElement so TS does not require us to extend JSX.IntrinsicElements
  // for the custom tag. Attribute names are kebab-case, which is exactly what
  // the underlying web component expects.
  const colorsAttr = buildColorsAttr(colors);
  return React.createElement('lord-icon', {
    src: resolvedSrc,
    trigger,
    colors: colorsAttr,
    delay,
    style: { ...dimensions, display: 'inline-block' },
    class: className,
    'aria-label': ariaLabel,
    'aria-hidden': ariaLabel ? undefined : true,
    role: ariaLabel ? 'img' : undefined,
    loop: loop ? 'true' : undefined,
    'data-lord-icon': 'true',
  });
}

LordIcon.displayName = 'LordIcon';

export { LORD_ICON_CATALOG };
export type { LordIconName };
