import Link from 'next/link';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Section } from '@segurasist/ui';
import { AccessDenied } from '../../_components/access-denied';
import { fetchMe } from '../../../lib/auth-server';
import { canAccess } from '../../../lib/rbac';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const me = await fetchMe();
  if (!me.role || !canAccess('/settings', me.role)) {
    return <AccessDenied />;
  }
  return (
    <div className="space-y-4">
      <Section title="Ajustes" description="Configura tu tenant." />
      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>
            Logo, colores, tagline e imagen de fondo. Vista previa en tiempo real.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm text-fg-muted">
            Personaliza cómo se ve el portal de tus asegurados.
          </p>
          <Button asChild>
            <Link href="/settings/branding">Abrir editor</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
