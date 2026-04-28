'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@segurasist/ui';
import { SidebarNav } from './sidebar-nav';
import { ThemeToggle } from './theme-toggle';
import { TenantSwitcher, TenantSwitcherDisabledForRole } from '../../components/header/tenant-switcher';
import { ROLE_LABEL, type Role } from '../../lib/rbac';

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export interface MobileDrawerProps {
  role: Role | null;
  userLabel: string;
  /**
   * H-25 — tenant del JWT del usuario, propagado por el layout server-component
   * (mismo prop que `<TenantSwitcher>` desktop). Mostrado a roles non-superadmin
   * en el read-only del drawer.
   */
  ownTenantLabel?: string;
}

/** Mobile-only drawer wrapping the sidebar nav. Closes on route change so nav
 *  taps don't leave the drawer open over the destination page.
 *
 *  H-25 — el tenant switcher mobile usa el mismo componente real que desktop
 *  (`<TenantSwitcher>`), no el mock hard-coded "mac". Para roles non-superadmin
 *  cae a `<TenantSwitcherDisabledForRole>` con el tenant del JWT. El componente
 *  desktop estaba shadow-clased a `lg:block`, así que envolvemos en un
 *  contenedor sin esa restricción para que aparezca también en el drawer. */
export function MobileDrawer({ role, userLabel, ownTenantLabel }: MobileDrawerProps): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const roleLabel = role ? ROLE_LABEL[role] : '';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="Abrir menú"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-muted active:bg-bg-elevated lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 lg:hidden" />
        <DialogPrimitive.Content
          aria-label="Navegación principal"
          className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r border-border bg-bg shadow-lg duration-base data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left lg:hidden"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <DialogPrimitive.Title className="sr-only">Menú</DialogPrimitive.Title>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <a href="/dashboard" className="flex items-center gap-2 text-[15px] font-semibold tracking-tightest text-fg">
              <div className="grid h-6 w-6 place-items-center rounded-md bg-fg text-bg">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="M5 12l4 4L19 6" />
                </svg>
              </div>
              SegurAsist
            </a>
            <DialogPrimitive.Close
              aria-label="Cerrar menú"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted active:bg-bg-elevated"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* H-25 — switcher real (mismo backing store + endpoint que desktop).
              Forzamos visibilidad mobile con `lg:hidden` override en el wrapper:
              el componente real tiene `hidden lg:block`, así que envolvemos en un
              <div> que neutraliza el hidden y deja el children visible en cualquier
              breakpoint del drawer (que ya es `<lg`). Para roles non-superadmin,
              `<TenantSwitcherDisabledForRole>` muestra el tenant del JWT. */}
          <div className="mobile-drawer-tenant-switcher border-b border-border px-3 py-3 [&>div]:!block [&>div]:w-full">
            {role === 'admin_segurasist' ? (
              <TenantSwitcher role={role} ownTenantLabel={ownTenantLabel} />
            ) : (
              <TenantSwitcherDisabledForRole ownTenantLabel={ownTenantLabel} />
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            <SidebarNav role={role} />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-[11px]">{initialsOf(userLabel)}</AvatarFallback>
              </Avatar>
              <div className="leading-tight">
                <p className="text-[13px] font-medium text-fg">{userLabel}</p>
                {roleLabel && (
                  <p className="text-[11px] uppercase tracking-wider text-fg-subtle">{roleLabel}</p>
                )}
              </div>
            </div>
            <ThemeToggle />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
