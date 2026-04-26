import { fetchMe } from '../../../lib/auth-server';
import { canAccess } from '../../../lib/rbac';
import { AccessDenied } from '../../_components/access-denied';
import { PackagesClient } from './packages-client';

export const dynamic = 'force-dynamic';

/**
 * S2-02 — Packages list page (server gate + client list).
 */
export default async function PackagesPage() {
  const me = await fetchMe();
  if (!me.role || !canAccess('/packages', me.role)) {
    return <AccessDenied />;
  }
  return <PackagesClient role={me.role} />;
}
