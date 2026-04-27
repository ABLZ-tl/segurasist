'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@segurasist/ui';

const STORAGE_KEY = 'segurasist-portal-theme';

type Theme = 'light' | 'dark';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const fromAttr = document.documentElement.dataset['theme'];
  if (fromAttr === 'dark' || fromAttr === 'light') return fromAttr;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* private mode / SSR */
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return 'light';
}

function applyTheme(next: Theme): void {
  const root = document.documentElement;
  if (next === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
  root.dataset['theme'] = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode */
  }
}

export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = React.useState<Theme>('light');

  React.useEffect(() => {
    const initial = readInitialTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggle = React.useCallback((): void => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      className={cn(
        'inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full',
        'text-fg-muted transition-colors duration-150',
        'hover:bg-bg-elevated hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
      )}
    >
      {theme === 'dark' ? (
        <Sun aria-hidden className="h-5 w-5" />
      ) : (
        <Moon aria-hidden className="h-5 w-5" />
      )}
    </button>
  );
}

export { STORAGE_KEY as PORTAL_THEME_STORAGE_KEY };
