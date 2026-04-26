import Link from 'next/link';
import type { Route } from 'next';
import type { LucideIcon } from 'lucide-react';
import { ChatWidget } from '@segurasist/ui';
import { Home, ShieldCheck, FileText, HelpCircle } from 'lucide-react';

const NAV: Array<{ href: Route; label: string; icon: LucideIcon }> = [
  { href: '/', label: 'Inicio', icon: Home },
  { href: '/coverages', label: 'Coberturas', icon: ShieldCheck },
  { href: '/certificate', label: 'Certificado', icon: FileText },
  { href: '/help', label: 'Ayuda', icon: HelpCircle },
];

/**
 * Mobile-first shell: sticky top bar with brand, scrollable main, and a
 * fixed bottom-nav (44px tap targets). Chatbot widget rendered globally.
 */
export default function PortalAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="rounded-md bg-primary px-2 py-1 text-xs text-primary-fg">MAC</span>
          Mi Membresía
        </Link>
      </header>

      <main id="main" className="flex-1 px-4 pb-24 pt-4">
        {children}
      </main>

      <nav
        aria-label="Navegación inferior"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-bg shadow-[0_-2px_6px_rgba(0,0,0,0.05)]"
      >
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-[44px] flex-col items-center justify-center gap-1 py-2 text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon aria-hidden className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <ChatWidget />
    </div>
  );
}
