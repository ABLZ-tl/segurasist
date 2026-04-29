'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@segurasist/ui';

export interface AdminUserMenuProps {
  email: string | null;
  roleLabel: string | null;
}

function initialsOf(name: string): string {
  const parts = name.split(/[@\s.+-_]+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((p) => p.charAt(0).toUpperCase()).join('');
}

/**
 * Admin app user menu: avatar click → panel con email/role + "Mi perfil"
 * + "Cerrar sesión".
 *
 * Click-outside y Escape cierran. Logout llama POST /api/auth/local-logout
 * (limpia cookies sa_session + sa_refresh) y redirige a /login.
 *
 * Mirror del UserMenu del portal con adaptación para admin (rol chip en
 * lugar de greeting, plus link a perfil).
 */
export function AdminUserMenu({ email, roleLabel }: AdminUserMenuProps): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const displayName = email ?? 'Usuario';
  const initials = initialsOf(displayName);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    function onPointer(e: MouseEvent): void {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const handleSignOut = React.useCallback(async (): Promise<void> => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch('/api/auth/local-logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch {
      // Cookies httpOnly se limpian server-side; si la req falla la
      // experiencia degrada a "te boto a /login y middleware reintenta".
    }
    router.replace('/login' as never);
    router.refresh();
  }, [router, signingOut]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Cerrar menú de usuario' : 'Abrir menú de usuario'}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:bg-bg-elevated lg:h-7 lg:w-7"
      >
        <Avatar className="h-8 w-8 lg:h-7 lg:w-7">
          <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
        </Avatar>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Menú de usuario"
          className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-md border border-border bg-bg-overlay shadow-lg"
        >
          <div className="border-b border-border px-3 py-3">
            <p className="truncate text-sm font-medium text-fg" title={displayName}>
              {displayName}
            </p>
            {roleLabel && (
              <p className="text-[11px] uppercase tracking-wider text-fg-subtle">
                {roleLabel}
              </p>
            )}
          </div>

          <div className="py-1">
            <Link
              href={'/profile' as never}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-[40px] items-center gap-3 px-3 text-sm text-fg transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:bg-bg-elevated"
            >
              <UserIcon aria-hidden className="h-4 w-4 text-fg-muted" />
              Mi perfil
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="flex min-h-[40px] w-full items-center gap-3 px-3 text-left text-sm text-fg transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:bg-bg-elevated disabled:opacity-60"
            >
              <LogOut aria-hidden className="h-4 w-4 text-fg-muted" />
              {signingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
