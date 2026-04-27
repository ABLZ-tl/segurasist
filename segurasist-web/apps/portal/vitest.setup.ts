/// <reference types="@testing-library/jest-dom" />
/**
 * Global test setup for the portal Vitest suite.
 *
 * Loads jest-dom matchers, then stubs the Next.js runtime modules that
 * client/server components import at module load time:
 *  - `next/navigation` (`useRouter`, `usePathname`, `useSearchParams`)
 *  - `next/headers` (`cookies`) — used by server-only modules under `lib/`
 *  - `server-only` — Next ships a guard that throws under jsdom; no-op it
 *  - `next/font/...` — Next injects fonts at build; tests just want a class
 *
 * Per-file tests can override any of these via `vi.mocked(...)` or local
 * `vi.mock(...)` calls. The defaults below are inert.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// --- next/navigation -------------------------------------------------------

const routerStub = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

let pathnameValue = '/';
let searchParamsValue = new URLSearchParams();

export function __setPathname(p: string): void {
  pathnameValue = p;
}
export function __setSearchParams(input: string | URLSearchParams): void {
  searchParamsValue =
    input instanceof URLSearchParams ? input : new URLSearchParams(input);
}

vi.mock('next/navigation', () => ({
  useRouter: (): typeof routerStub => routerStub,
  usePathname: (): string => pathnameValue,
  useSearchParams: (): URLSearchParams => searchParamsValue,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

beforeEach(() => {
  routerStub.push.mockReset();
  routerStub.replace.mockReset();
  routerStub.back.mockReset();
  routerStub.forward.mockReset();
  routerStub.refresh.mockReset();
  routerStub.prefetch.mockReset();
  pathnameValue = '/';
  searchParamsValue = new URLSearchParams();
});

export { routerStub as __routerStub };

// --- server-only ----------------------------------------------------------
vi.mock('server-only', () => ({}));

// --- next/headers ---------------------------------------------------------

interface CookieJar {
  get: (name: string) => { value: string } | undefined;
  set: (name: string, value: string) => void;
  __setCookie: (name: string, value: string | undefined) => void;
  __reset: () => void;
}

function createCookieJar(): CookieJar {
  const store = new Map<string, string>();
  return {
    get: (name: string) => {
      const value = store.get(name);
      return value === undefined ? undefined : { value };
    },
    set: (name: string, value: string) => {
      store.set(name, value);
    },
    __setCookie: (name, value) => {
      if (value === undefined) store.delete(name);
      else store.set(name, value);
    },
    __reset: () => store.clear(),
  };
}

const cookieJar = createCookieJar();

vi.mock('next/headers', () => ({
  cookies: (): CookieJar => cookieJar,
  headers: (): Map<string, string> => new Map(),
}));

beforeEach(() => {
  cookieJar.__reset();
});

export { cookieJar };

// --- next/font ------------------------------------------------------------

vi.mock('next/font/google', () => {
  return new Proxy(
    {},
    {
      get: () => () => ({
        className: 'mock-font',
        style: { fontFamily: 'mock-font' },
        variable: '--mock-font',
      }),
    },
  );
});

vi.mock('next/font/local', () => ({
  default: () => ({
    className: 'mock-font',
    style: { fontFamily: 'mock-font' },
    variable: '--mock-font',
  }),
}));

// --- localStorage shim ----------------------------------------------------
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

function installStorage(target: object, name: 'localStorage' | 'sessionStorage'): void {
  try {
    delete (target as Record<string, unknown>)[name];
  } catch {
    /* non-configurable on some Node builds */
  }
  Object.defineProperty(target, name, {
    configurable: true,
    writable: true,
    value: new MemoryStorage(),
  });
}

if (typeof window !== 'undefined') {
  installStorage(window, 'localStorage');
  installStorage(window, 'sessionStorage');
}
installStorage(globalThis, 'localStorage');
installStorage(globalThis, 'sessionStorage');

beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
});

// --- jsdom polyfills ------------------------------------------------------

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList;
  }
  if (!('IntersectionObserver' in window)) {
    class IO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    (window as unknown as { IntersectionObserver: typeof IO }).IntersectionObserver = IO;
  }
  if (!('ResizeObserver' in window)) {
    class RO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (window as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = (): boolean => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = (): void => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function (): void {};
  }
}

// --- framer-motion --------------------------------------------------------
// In jsdom we don't need real animation; stub the components/AnimatePresence
// so they pass children through and don't tax the renderer. We strip the
// motion-only props (initial/animate/exit/transition/whileX/variants) so
// React doesn't warn about unknown DOM attributes.
import * as React from 'react';

const MOTION_PROPS = new Set([
  'initial',
  'animate',
  'exit',
  'transition',
  'variants',
  'whileHover',
  'whileTap',
  'whileFocus',
  'whileInView',
  'whileDrag',
  'layout',
  'layoutId',
  'drag',
  'dragConstraints',
]);

function stripMotionProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (!MOTION_PROPS.has(key)) out[key] = props[key];
  }
  return out;
}

vi.mock('framer-motion', () => {
  const motion = new Proxy(
    {},
    {
      get: (_t, tag: string) =>
        function MotionStub(props: Record<string, unknown>): React.ReactElement {
          return React.createElement(tag, stripMotionProps(props));
        },
    },
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    LazyMotion: ({ children }: { children: React.ReactNode }) => children,
    domAnimation: {},
    m: motion,
    useReducedMotion: () => false,
    useScroll: () => ({ scrollY: { get: () => 0, on: () => () => {} } }),
    useTransform: () => 0,
  };
});
