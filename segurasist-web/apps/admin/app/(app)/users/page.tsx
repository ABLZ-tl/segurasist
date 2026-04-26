import { Button, EmptyState, Section } from '@segurasist/ui';
import { AccessDenied } from '../../_components/access-denied';
import { fetchMe } from '../../../lib/auth-server';
import { canAccess } from '../../../lib/rbac';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const me = await fetchMe();
  if (!me.role || !canAccess('/users', me.role)) {
    return <AccessDenied />;
  }
  return (
    <div className="space-y-4">
      <Section title="Usuarios" description="Operadores y administradores." actions={<Button>Invitar usuario</Button>} />
      <EmptyState title="Sin usuarios visibles" description="Tu rol determina qué usuarios puedes ver." />
    </div>
  );
}
