'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Home, ShieldCheck, FileText, HelpCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@segurasist/ui';

interface NavItem {
  href: Route;
  label: string;
  icon: LucideIcon;
}

const NAV: readonly NavItem[] = [
  { href: '/' as Route, label: 'Inicio', icon: Home },
  { href: '/coverages' as Route, label: 'Coberturas', icon: ShieldCheck },
  { href: '/certificate' as Route, label: 'Certificado', icon: FileText },
  { href: '/help' as Route, label: 'Ayuda', icon: HelpCircle },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Bottom navigation bar — sticky, 4 icons, backdrop blur.
 *
 * - Each item is at least 44×44px (touch target standard).
 * - Active item is rendered in accent color and visually scaled by 1.05x.
 * - The container respects iOS safe-area-inset-bottom so the nav clears the
 *   home-indicator without using ugly system padding.
 */
export function PortalBottomNav(): JSX.Element {
  const pathname = usePathname() ?? '/';

  return (
    <nav
      aria-label="Navegación inferior"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/85 backdrop-blur-md"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.25rem)' }}
      data-testid="portal-bottom-nav"
    >
      <ul className="grid grid-cols-4">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                data-active={active || undefined}
                className={cn(
                  'flex min-h-[44px] flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium',
                  'transition-transform duration-150 ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  active
                    ? 'scale-[1.05] text-accent'
                    : 'text-fg-muted hover:text-fg active:text-fg',
                )}
              >
                <Icon aria-hidden className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
