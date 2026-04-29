/**
 * Sprint 5 — MT-2 iter 1.
 *
 * Server Component shell para el editor de branding del tenant.
 *
 * RBAC:
 *   Solo `admin_segurasist` (superadmin) y `admin_mac` (tenant_admin) pueden
 *   editar branding. Otros roles → <AccessDenied />.
 *
 *   El briefing usa los nombres conceptuales "superadmin" / "tenant_admin",
 *   pero en el código (rbac.ts) son `admin_segurasist` y `admin_mac`. Aquí
 *   gateamos por el set permitido — `canAccess('/settings', role)` ya
 *   permite estos dos roles, pero re-validamos explícitamente para que el
 *   día que `/settings` se abra a `supervisor` el branding siga restringido.
 *
 * El form vive en un Client Component (`branding-client.tsx`) porque usa
 * react-hook-form + react-query + GSAP/Lordicon (todo client-only).
 */

import { AccessDenied } from '../../../_components/access-denied';
import { fetchMe } from '../../../../lib/auth-server';
import { BrandingClient } from './branding-client';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['admin_segurasist', 'admin_mac']);

export default async function BrandingPage(): Promise<JSX.Element> {
  const me = await fetchMe();
  if (!me.role || !ALLOWED_ROLES.has(me.role) || !me.tenantId) {
    return <AccessDenied description="Solo los administradores pueden editar el branding del tenant." />;
  }
  return <BrandingClient tenantId={me.tenantId} />;
}
