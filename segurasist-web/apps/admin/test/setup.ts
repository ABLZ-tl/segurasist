/**
 * Global test setup for the admin Vitest suite.
 *
 * Loads jest-dom matchers, then defines lightweight stubs for the Next.js
 * runtime modules that client components import at module load time:
 *  - `next/navigation` (`useRouter`, `usePathname`, `useSearchParams`)
 *  - `next/headers` (`cookies`) — used by server-only modules under `lib/`
 *  - `next/font/...` — Next injects fonts at build time; in tests we just
 *    return a no-op className.
 *
 * Each test file is free to override these via `vi.mocked(...)` or per-file
 * `vi.mock(...)`. The defaults below are inert so importing a component
 * doesn't crash before a test gets to wire up its expectations.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

vi.mock('next/navigation', () => {
  const params = new URLSearchParams();
  return {
    useRouter: (): typeof routerStub => routerStub,
    usePathname: (): string => '/',
    useSearchParams: (): URLSearchParams => params,
    redirect: vi.fn(),
    notFound: vi.fn(),
  };
});

beforeEach(() => {
  routerStub.push.mockReset();
  routerStub.replace.mockReset();
  routerStub.back.mockReset();
  routerStub.forward.mockReset();
  routerStub.refresh.mockReset();
  routerStub.prefetch.mockReset();
});

// --- server-only ----------------------------------------------------------
// Next ships a stub that throws when imported in client bundles; in jsdom
// tests we want the module to be a no-op so server-only imports succeed.
vi.mock('server-only', () => ({}));

// --- next/headers ---------------------------------------------------------
// `cookies()` returns a Map-like object. Tests that exercise auth-server.ts
// override `__setCookie(name, value)` to seed the jar.

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

// Expose the jar for tests that need to seed it.
// (Importing from `test/setup` is unusual; see `test/helpers/cookies.ts`.)
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

// --- localStorage shim ---------------------------------------------------
// Node 22+ exposes an experimental Web-Storage global that returns an object
// missing parts of the spec (no `.clear`, no `.removeItem`) when no
// `--localstorage-file` is configured. jsdom 24 happily exposes that broken
// shape via `window.localStorage` rather than installing its own Storage.
// We replace both with a plain in-memory implementation that matches the
// Storage interface tests rely on.
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

// --- @segurasist/ui Sprint 5 deps (DS-1) ---------------------------------
// MT-2 iter 2 (CC-21): tests now consume the real LordIcon/GsapFade/GsapStagger
// from `@segurasist/ui`. Both pull GSAP and the `lord-icon` web component at
// module scope. In jsdom we mock them with no-op shims so the tests stay
// deterministic and we don't ship `requestAnimationFrame` jitter into snapshots.

vi.mock('gsap', () => {
  const tween = { kill: vi.fn() };
  const gsapStub = {
    fromTo: vi.fn(() => tween),
    from: vi.fn(() => tween),
    to: vi.fn(() => tween),
    set: vi.fn(() => tween),
    registerPlugin: vi.fn(),
  };
  return { default: gsapStub, ...gsapStub };
});

// `lord-icon-element` registers a custom element on import. We stub the
// `defineElement` entrypoint so the LordIcon wrapper's lazy import resolves
// without touching real lottie/web-component infra.
vi.mock('lord-icon-element', () => ({
  defineElement: vi.fn(),
}));

vi.mock('lottie-web', () => ({
  default: { loadAnimation: vi.fn() },
  loadAnimation: vi.fn(),
}));

// --- jsdom polyfills ------------------------------------------------------
// jsdom doesn't ship matchMedia or IntersectionObserver; stub them so
// downstream libs (framer-motion, cmdk) don't blow up during render.

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
  // cmdk relies on scrollIntoView in jsdom which doesn't implement it.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function (): void {};
  }
  // jsdom 24 stubbed `URL.createObjectURL`/`revokeObjectURL` only on the
  // window-bound URL but not the global one. Branding editor uses both
  // for the optimistic logo preview (`onUploadLogo`) and the dropzone's
  // image-dimension validator. Provide deterministic fakes so jsdom tests
  // exercise the full flow without throwing.
  if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL =
      (): string => 'blob:mock-' + Math.random().toString(36).slice(2);
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL =
      (): void => {};
  }
}
