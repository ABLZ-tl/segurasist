/**
 * Sprint 5 — S5-3 finisher.
 *
 * Server Component shell del editor KB del chatbot.
 *
 * RBAC:
 *   Solo `admin_segurasist` y `admin_mac` pueden gestionar KB. Otros roles
 *   (operator, supervisor, insured, sin sesión) → <AccessDenied />.
 *
 *   El briefing menciona conceptualmente "superadmin" / "tenant_admin"; en el
 *   código (rbac.ts) son `admin_segurasist` y `admin_mac`. Adoptamos los
 *   nombres reales del módulo para no divergir de MT-2 / sidebar admin.
 *
 * El editor vive en un Client Component (`kb-list-client.tsx`) porque usa
 * react-hook-form + react-query + GSAP/Lordicon. Aquí solo gateamos.
 */
import { AccessDenied } from '../../../_components/access-denied';
import { fetchMe } from '../../../../lib/auth-server';
import { KbListClient } from './kb-list-client';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['admin_segurasist', 'admin_mac']);

export default async function KbPage(): Promise<JSX.Element> {
  const me = await fetchMe();
  if (!me.role || !ALLOWED_ROLES.has(me.role)) {
    return (
      <AccessDenied description="Solo los administradores pueden gestionar la base de conocimiento del chatbot." />
    );
  }
  return <KbListClient role={me.role} />;
}
