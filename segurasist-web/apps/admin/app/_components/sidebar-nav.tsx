'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Layers,
  Package,
  BarChart3,
  Settings,
  UserCog,
} from 'lucide-react';
import { cn } from '@segurasist/ui';
import {
  visibleNavFor,
  type NavItem,
  type NavSection,
  type Role,
} from '../../lib/rbac';

/** Lucide icon resolver. Keeping this map here (instead of in lib/rbac.ts)
 *  prevents the matrix module from coupling to the icon library and lets
 *  Server Components import `lib/rbac` without dragging Lucide in. */
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Users,
  Layers,
  Package,
  BarChart3,
  Settings,
  UserCog,
};

const SECTION_TITLE: Record<NavSection, string> = {
  general: 'General',
  admin: 'Administración',
};

function NavGroup({
  title,
  items,
  pathname,
}: {
  title: string;
  items: readonly NavItem[];
  pathname: string;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-fg-subtle lg:pb-0.5 lg:pt-2">
        {title}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const Icon = ICON_MAP[item.iconKey];
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href as Route}
                className={cn(
                  'group relative flex items-center gap-3 rounded-md px-3 py-3 text-[14px] font-medium transition-colors duration-fast lg:gap-2.5 lg:py-1.5 lg:text-[13px]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-bg-elevated text-fg'
                    : 'text-fg-muted active:bg-bg-elevated lg:hover:bg-bg-elevated lg:hover:text-fg',
                )}
                aria-current={active ? 'page' : undefined}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute -left-px top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent"
                  />
                )}
                {Icon && (
                  <Icon
                    aria-hidden
                    className={cn(
                      'h-[18px] w-[18px] lg:h-4 lg:w-4',
                      active ? 'text-fg' : 'text-fg-subtle lg:group-hover:text-fg-muted',
                    )}
                  />
                )}
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface SidebarNavProps {
  /** Authoritative role for the current user. When null (e.g. /me failed),
   *  the sidebar collapses to its meta footer; the layout still renders. */
  role: Role | null;
}

export function SidebarNav({ role }: SidebarNavProps): JSX.Element {
  const pathname = usePathname() ?? '';
  const items = role ? visibleNavFor(role) : [];
  const general = items.filter((i) => i.section === 'general');
  const admin = items.filter((i) => i.section === 'admin');

  return (
    <nav
      aria-label="Navegación principal"
      className="flex h-full flex-col px-3 py-4 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)]"
    >
      {general.length > 0 && (
        <NavGroup title={SECTION_TITLE.general} items={general} pathname={pathname} />
      )}
      {admin.length > 0 && (
        <div className={cn(general.length > 0 && 'mt-2')}>
          <NavGroup title={SECTION_TITLE.admin} items={admin} pathname={pathname} />
        </div>
      )}
      <div className="mt-auto border-t border-border pt-3">
        <p className="px-3 text-[11px] text-fg-subtle">v0.1.0 · MAC</p>
      </div>
    </nav>
  );
}
