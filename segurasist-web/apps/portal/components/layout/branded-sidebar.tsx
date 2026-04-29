'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Home, ShieldCheck, FileText, HelpCircle } from 'lucide-react';
import { cn, LordIcon, type LordIconName } from '@segurasist/ui';
import { useTenantBranding } from '../../lib/hooks/use-tenant-branding';

/**
 * Branded sidebar — visible solo en `md+` (tablet/desktop).
 *
 * Decisión de diseño (MT-3 iter 1):
 *  El portal asegurado en mobile usa `<PortalBottomNav>` (4 tabs sticky
 *  bottom). DISPATCH_PLAN nombra `branded-sidebar.tsx` como path bajo
 *  ownership de MT-3, pero el shell mobile NO tiene sidebar. Esta
 *  implementación cubre el caso desktop/tablet (cliente abriendo el portal
 *  desde laptop) — `hidden md:flex` para no romper layout mobile.
 *
 *  La lógica de active-route es idéntica al `<PortalBottomNav>` para que
 *  ambos navs queden sincronizados (DRY contendría toparse con server vs
 *  client diff — preferimos duplicar 6 líneas).
 *
 * Lordicons (`@segurasist/ui`): cada item usa un nombre del catálogo DS-1
 * con `fallback={Lucide}` para SSR/pre-hidratación. Nombres placeholder
 * (`<TODO_ID_*>` en el catálogo) caen al fallback hasta que CC-15 los
 * resuelva.
 */
const NAV: ReadonlyArray<{
  href: Route;
  label: string;
  icon: typeof Home;
  /** Nombre del catálogo `@segurasist/ui` (DS-1). */
  lordName: LordIconName;
}> = [
  // Mapeo a nombres reales del catalog DS-1 (algunos siguen con
  // `<TODO_ID_*>` — el fallback Lucide cubre el render hasta que la URL
  // canonical esté en el catálogo, ver CC-15).
  { href: '/' as Route, label: 'Inicio', icon: Home, lordName: 'dashboard-grid' },
  {
    href: '/coverages' as Route,
    label: 'Coberturas',
    icon: ShieldCheck,
    lordName: 'shield-check',
  },
  {
    href: '/certificate' as Route,
    label: 'Certificado',
    icon: FileText,
    lordName: 'file-document',
  },
  {
    href: '/help' as Route,
    label: 'Ayuda',
    icon: HelpCircle,
    lordName: 'chat-bubble',
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BrandedSidebar(): JSX.Element {
  const pathname = usePathname() ?? '/';
  const { displayName } = useTenantBranding();

  return (
    <aside
      aria-label={`Navegación lateral ${displayName}`}
      className="sticky top-[64px] hidden h-[calc(100vh-64px)] w-56 shrink-0 flex-col gap-1 px-3 py-4 md:flex"
      data-testid="portal-branded-sidebar"
    >
      <nav>
        <ul className="flex flex-col gap-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-fast',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    active
                      ? 'bg-accent/10 text-accent'
                      : 'text-fg-muted hover:bg-bg-elevated hover:text-fg',
                  )}
                >
                  <LordIcon
                    name={item.lordName}
                    trigger="hover"
                    size={22}
                    ariaLabel={item.label}
                    fallback={
                      <Icon
                        aria-hidden
                        style={{ width: 22, height: 22 }}
                      />
                    }
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
