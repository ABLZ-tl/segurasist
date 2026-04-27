'use client';

/**
 * S3-08 — Bridge cliente que conecta el store Zustand del admin con el fetch
 * wrapper de `@segurasist/api-client`.
 *
 * Por qué un componente bridge: el wrapper vive en un package compartido que
 * NO debe importar el store del admin (cross-app coupling). Pattern: el admin
 * registra un getter al montar; el wrapper lo usa para leer el override en
 * cada request.
 *
 * Solo monta el getter en el cliente (useEffect garantiza que ocurra
 * post-hydration; en SSR el wrapper ve `window === undefined` y no consulta).
 *
 * El bridge no renderiza UI.
 */

import * as React from 'react';
import { registerTenantOverrideGetter } from '@segurasist/api-client';
import { useTenantOverride } from '../../lib/hooks/use-tenant-override';

export function TenantOverrideBridge(): null {
  React.useEffect(() => {
    registerTenantOverrideGetter(() => useTenantOverride.getState().overrideTenantId);
    return () => registerTenantOverrideGetter(null);
  }, []);
  return null;
}
