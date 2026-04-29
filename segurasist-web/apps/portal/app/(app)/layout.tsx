import { PortalHeader } from '../../components/layout/header';
import { PortalBottomNav } from '../../components/layout/bottom-nav';
import { ChatbotWidget } from '../../components/chatbot';
import { getInsuredFirstName, getInsuredIdentity } from '../../lib/insured-session';

/**
 * Portal asegurado app shell — mobile-first.
 *
 *  - Sticky header with brand + greeting + theme toggle.
 *  - Scrollable main column with bottom padding to clear the fixed nav (80px)
 *    plus iOS safe area.
 *  - Sticky bottom nav (4 tabs).
 *  - Floating chatbot widget (S4-05) above the bottom nav. Reemplaza al
 *    placeholder `ChatFab` que solo emitía un toast "próximamente".
 *
 * The wrapper Server Component reads the JWT cookie once and forwards the
 * extracted first name into the (client) header so the greeting is rendered
 * in the same paint as the rest of the shell — no flash of "Hola" → "Hola, X".
 *
 * Auth gate: este layout vive bajo `(app)`, donde el middleware del portal
 * (`apps/portal/middleware.ts`) ya redirige a `/login` si no hay cookie de
 * sesión. Por eso el widget se monta sin chequeo adicional — todo render
 * implica usuario autenticado.
 */
export default function PortalAppLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const firstName = getInsuredFirstName();
  const { fullName, email } = getInsuredIdentity();

  return (
    <div
      className="flex min-h-screen flex-col bg-bg text-fg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <PortalHeader firstName={firstName} fullName={fullName} email={email} />

      <main id="main" className="flex-1 px-4 pt-4 pb-24">
        {children}
      </main>

      <PortalBottomNav />
      <ChatbotWidget />
    </div>
  );
}
