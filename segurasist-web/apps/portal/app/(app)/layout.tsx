import { PortalHeader } from '../../components/layout/header';
import { PortalBottomNav } from '../../components/layout/bottom-nav';
import { ChatFab } from '../../components/layout/chat-fab';
import { getInsuredFirstName } from '../../lib/insured-session';

/**
 * Portal asegurado app shell — mobile-first.
 *
 *  - Sticky header with brand + greeting + theme toggle.
 *  - Scrollable main column with bottom padding to clear the fixed nav (80px)
 *    plus iOS safe area.
 *  - Sticky bottom nav (4 tabs).
 *  - Floating chat FAB above the bottom nav.
 *
 * The wrapper Server Component reads the JWT cookie once and forwards the
 * extracted first name into the (client) header so the greeting is rendered
 * in the same paint as the rest of the shell — no flash of "Hola" → "Hola, X".
 */
export default function PortalAppLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const firstName = getInsuredFirstName();

  return (
    <div
      className="flex min-h-screen flex-col bg-bg text-fg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <PortalHeader firstName={firstName} />

      <main id="main" className="flex-1 px-4 pt-4 pb-24">
        {children}
      </main>

      <PortalBottomNav />
      <ChatFab />
    </div>
  );
}
