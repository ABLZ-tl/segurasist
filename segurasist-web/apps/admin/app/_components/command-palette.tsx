'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  LayoutDashboard,
  Users,
  Layers,
  Package,
  BarChart3,
  Settings,
  UserCog,
  Search,
  Plus,
  Upload,
} from 'lucide-react';

const NAV: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }>; shortcut?: string }> = [
  { href: '/dashboard', label: 'Resumen', icon: LayoutDashboard, shortcut: 'G D' },
  { href: '/insureds', label: 'Asegurados', icon: Users, shortcut: 'G I' },
  { href: '/batches', label: 'Lotes', icon: Layers, shortcut: 'G B' },
  { href: '/packages', label: 'Paquetes', icon: Package, shortcut: 'G P' },
  { href: '/reports', label: 'Reportes', icon: BarChart3, shortcut: 'G R' },
  { href: '/users', label: 'Usuarios', icon: UserCog, shortcut: 'G U' },
  { href: '/settings', label: 'Ajustes', icon: Settings, shortcut: 'G S' },
];

const ACTIONS: Array<{ id: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'create-insured', label: 'Crear asegurado', icon: Plus },
  { id: 'upload-batch', label: 'Subir lote', icon: Upload },
];

export function CommandPalette(): JSX.Element | null {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      // Untyped routes — cmd palette is freeform; cast at the boundary
      router.push(href as never);
    },
    [router],
  );

  if (!mounted) return null;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Paleta de comandos"
      shouldFilter
      overlayClassName="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in md:bg-black/40"
      contentClassName="fixed inset-x-0 bottom-0 z-50 w-full overflow-hidden rounded-t-xl border border-b-0 border-border bg-bg-overlay shadow-lg animate-fade-up focus:outline-none md:bottom-auto md:left-1/2 md:top-[12vh] md:w-[92vw] md:max-w-[560px] md:-translate-x-1/2 md:rounded-lg md:border-b"
    >
      <div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search aria-hidden className="h-4 w-4 text-fg-subtle" />
          <Command.Input
            placeholder="Buscar páginas, asegurados, lotes..."
            className="flex h-12 w-full bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
          />
          <kbd className="hidden h-5 select-none items-center gap-1 rounded border border-border bg-bg-elevated px-1.5 font-mono text-[10px] text-fg-muted md:inline-flex">
            esc
          </kbd>
        </div>
        <Command.List className="max-h-[70vh] overflow-y-auto p-2 md:max-h-[60vh]">
          <Command.Empty className="px-3 py-6 text-center text-sm text-fg-muted">
            Sin resultados.
          </Command.Empty>
          <Command.Group
            heading="Navegación"
            className="px-1 py-1 text-[11px] font-medium uppercase tracking-wider text-fg-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
          >
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Command.Item
                  key={item.href}
                  value={`${item.label} ${item.href}`}
                  onSelect={() => go(item.href)}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-3 text-sm text-fg aria-selected:bg-bg-elevated md:py-2"
                >
                  <Icon className="h-4 w-4 text-fg-muted" />
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && (
                    <kbd className="hidden font-mono text-[10px] text-fg-subtle md:inline">{item.shortcut}</kbd>
                  )}
                </Command.Item>
              );
            })}
          </Command.Group>
          <Command.Group
            heading="Acciones"
            className="mt-1 px-1 py-1 text-[11px] font-medium uppercase tracking-wider text-fg-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
          >
            {ACTIONS.map((a) => {
              const Icon = a.icon;
              return (
                <Command.Item
                  key={a.id}
                  value={a.label}
                  onSelect={() => setOpen(false)}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-3 text-sm text-fg aria-selected:bg-bg-elevated md:py-2"
                >
                  <Icon className="h-4 w-4 text-fg-muted" />
                  <span>{a.label}</span>
                </Command.Item>
              );
            })}
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
