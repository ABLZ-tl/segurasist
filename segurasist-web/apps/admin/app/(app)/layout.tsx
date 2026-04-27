import { Avatar, AvatarFallback } from '@segurasist/ui';
import { ThemeToggle } from '../_components/theme-toggle';
import { SidebarNav } from '../_components/sidebar-nav';
import { CommandKTrigger } from '../_components/command-k-trigger';
import { MobileDrawer } from '../_components/mobile-drawer';
import { MobileSearchTrigger } from '../_components/mobile-search-trigger';
import { TenantSwitcher } from '../../components/header/tenant-switcher';
import { TenantOverrideBridge } from '../../components/header/tenant-override-bridge';
import { TenantOverrideBanner } from '../../components/layout/tenant-override-banner';
import { ROLE_LABEL } from '../../lib/rbac';
import { fetchMe } from '../../lib/auth-server';

/** Inline copy: `initialsOf` is exported from a 'use client' module in
 *  @segurasist/ui, so referencing it from this Server Component returns a
 *  client reference (not the function). Compute it locally. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/**
 * App-shell layout.
 * Desktop (lg+): sticky 56px topbar with brand, tenant switcher, ⌘K, theme, role chip, avatar.
 * Mobile (<lg): topbar collapses to hamburger + brand + search-icon + avatar; sidebar
 * becomes a slide-in drawer launched from the hamburger.
 *
 * The shell fetches the current user once (via `/v1/auth/me`) and passes the
 * role down to navigation so it filters items via the FE RBAC matrix.
 * If the call fails, role is `null` — sidebar collapses to its footer and
 * the role chip is hidden, but the rest of the page still renders.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await fetchMe();
  const userLabel = me.email ?? 'Usuario';
  const roleLabel = me.role ? ROLE_LABEL[me.role] : null;

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      {/* S3-08 — registra el getter del store Zustand en el wrapper api-client. */}
      <TenantOverrideBridge />
      <header
        className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-bg/80 px-3 backdrop-blur-md sm:gap-4 sm:px-4 lg:px-6"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center gap-2 lg:gap-3">
          <MobileDrawer role={me.role} userLabel={userLabel} />
          <a
            href="/dashboard"
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tightest text-fg lg:text-[15px]"
          >
            <div className="grid h-6 w-6 place-items-center rounded-md bg-fg text-bg">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M5 12l4 4L19 6" />
              </svg>
            </div>
            <span>SegurAsist</span>
          </a>
          <span className="hidden h-4 w-px bg-border lg:inline-block" />
          {/* S3-08 — switcher real (admin_segurasist) o read-only para los demás. */}
          <TenantSwitcher role={me.role} ownTenantLabel={me.tenantId ?? undefined} />
        </div>

        <div className="hidden flex-1 justify-center lg:flex">
          <CommandKTrigger />
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <MobileSearchTrigger />
          <div className="hidden lg:inline-flex">
            <ThemeToggle />
          </div>
          <span className="hidden h-4 w-px bg-border lg:inline-block" />
          {roleLabel && (
            <span className="hidden rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-fg-muted lg:inline">
              {roleLabel}
            </span>
          )}
          <Avatar className="h-8 w-8 lg:h-7 lg:w-7">
            <AvatarFallback className="text-[11px]">{initialsOf(userLabel)}</AvatarFallback>
          </Avatar>
        </div>
      </header>

      {/* S3-08 — banner amber persistente cuando el switcher está activo. */}
      <TenantOverrideBanner />

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-border bg-bg lg:block">
          <SidebarNav role={me.role} />
        </aside>

        <main id="main" className="min-w-0 flex-1">
          <div
            className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.25rem)' }}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
