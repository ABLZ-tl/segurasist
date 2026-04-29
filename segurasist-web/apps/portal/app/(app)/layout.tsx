import { BrandedHeader } from '../../components/layout/branded-header';
import { BrandedFooter } from '../../components/layout/branded-footer';
import { BrandedSidebar } from '../../components/layout/branded-sidebar';
import { KeyedPageTransition } from '../../components/layout/keyed-page-transition';
import { PortalBottomNav } from '../../components/layout/bottom-nav';
import { ChatbotWidget } from '../../components/chatbot';
import { TenantProvider } from '../../components/tenant/tenant-provider';
import { getInsuredFirstName, getInsuredIdentity } from '../../lib/insured-session';

/**
 * Portal asegurado app shell — multi-tenant aware (Sprint 5 / MT-3).
 *
 *  - Wrapper `<TenantProvider>` carga branding del tenant via
 *    `/api/proxy/v1/tenants/me/branding` (SWR 5min stale).
 *  - `<BrandedHeader>` reemplaza al header hard-codeado a "Hospitales MAC":
 *    consume displayName/logoUrl/primaryHex del Provider.
 *  - `<BrandedSidebar>` aparece solo en `md+` (mobile sigue usando bottom-nav).
 *  - `<BrandedFooter>` con tagline tenant + año + links institucionales.
 *  - `<KeyedPageTransition>` envuelve el main para slide+fade 250ms al cambiar
 *    de ruta. Importa `<PageTransition>` definitivo de `@segurasist/ui`
 *    (CC-21) y le inyecta el pathname como `routeKey`.
 *  - Chatbot widget se preserva tal cual (S4-05).
 *
 * Auth gate sigue siendo el del middleware — TenantProvider asume usuario
 * autenticado. Si la cookie expira mid-session, el provider detecta 401
 * en la branding-fetch y dispara redirect a /login (ver tenant-provider.tsx).
 *
 * TODO(CC-22, Sprint 6): SSR initial-data del branding.
 *   Pre-fetch server-side de `${API_BASE_URL}/v1/tenants/me/branding` con el
 *   JWT del cookie y pasarlo a `<TenantProvider initialData={...}>` para que
 *   el primer paint ya tenga colores/logo del tenant (sin flash 200-400ms
 *   con defaults SegurAsist). Diferido porque:
 *     - Requiere cookie forwarding RSC → backend con manejo de 401/redirect
 *       desde el server (vs. el branch cliente actual que solo redirige
 *       en useEffect).
 *     - El proxy `/api/proxy/[...path]` está pensado para browser, no para
 *       server-to-server, así que necesita un helper paralelo en `lib/`.
 *     - Hay que decidir si el fetch fallido bloquea el render del shell o
 *       cae a defaults (decisión UX abierta — alinear con S5 design review).
 *   Best-effort prevista: helper `getInitialBranding()` en `lib/` que
 *   retorna `BrandingApiResponse | null` y se pasa como prop.
 */
export default function PortalAppLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const firstName = getInsuredFirstName();
  const { fullName, email } = getInsuredIdentity();

  return (
    <TenantProvider>
      <div
        className="flex min-h-screen flex-col bg-bg text-fg"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <BrandedHeader firstName={firstName} fullName={fullName} email={email} />

        <div className="flex flex-1 md:gap-4 md:px-4">
          <BrandedSidebar />

          <main id="main" className="flex-1 px-4 pt-4 pb-24 md:px-0">
            <KeyedPageTransition>{children}</KeyedPageTransition>
            <BrandedFooter />
          </main>
        </div>

        <PortalBottomNav />
        <ChatbotWidget />
      </div>
    </TenantProvider>
  );
}
