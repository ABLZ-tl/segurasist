import { Button, EmptyState, Section } from '@segurasist/ui';
import { AccessDenied } from '../../_components/access-denied';
import { fetchMe } from '../../../lib/auth-server';
import { canAccess } from '../../../lib/rbac';

export const dynamic = 'force-dynamic';

export default async function PackagesPage() {
  const me = await fetchMe();
  if (!me.role || !canAccess('/packages', me.role)) {
    return <AccessDenied />;
  }
  return (
    <div className="space-y-4">
      <Section title="Paquetes" description="Configura paquetes y coberturas." actions={<Button>Nuevo paquete</Button>} />
      <EmptyState title="Aún no hay paquetes" description="Crea tu primer paquete para vincular coberturas." />
    </div>
  );
}
