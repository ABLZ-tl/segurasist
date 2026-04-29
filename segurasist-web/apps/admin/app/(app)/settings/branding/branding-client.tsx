'use client';

/**
 * Sprint 5 — MT-2 iter 1.
 *
 * Client wrapper del <BrandingEditor>. Responsabilidades:
 *   - Marcar la frontera 'use client' (lib usa react-hook-form, GSAP stub).
 *   - Recibir `tenantId` resuelto en el Server Component.
 *
 * No replicamos lógica de auth aquí; el page.tsx ya gateó por rol. Si el
 * usuario llega acá vía deep link sin permiso, el endpoint retornará 403
 * y el editor mostrará el error inline de react-query.
 */

import { BrandingEditor } from '../../../../components/branding-editor';

export interface BrandingClientProps {
  tenantId: string;
}

export function BrandingClient({ tenantId }: BrandingClientProps): JSX.Element {
  return <BrandingEditor tenantId={tenantId} />;
}
