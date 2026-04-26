import { Card, CardContent, CardDescription, CardHeader, CardTitle, Section } from '@segurasist/ui';
import { AccessDenied } from '../../_components/access-denied';
import { fetchMe } from '../../../lib/auth-server';
import { canAccess } from '../../../lib/rbac';

export const dynamic = 'force-dynamic';

const REPORTS = [
  {
    id: 'monthly',
    title: 'Conciliación mensual',
    description: 'Genera el reporte mensual en PDF + XLSX por entidad.',
  },
  {
    id: 'volumetry',
    title: 'Volumetría',
    description: 'Altas, bajas y certificados emitidos por rango.',
  },
  {
    id: 'usage',
    title: 'Utilización por cobertura',
    description: 'Top consumidores y porcentaje de uso por paquete.',
  },
];

export default async function ReportsPage() {
  const me = await fetchMe();
  if (!me.role || !canAccess('/reports', me.role)) {
    return <AccessDenied />;
  }
  return (
    <div className="space-y-4">
      <Section title="Reportes" description="Genera y programa reportes." />
      <div className="grid gap-4 md:grid-cols-3">
        {REPORTS.map((r) => (
          <Card key={r.id}>
            <CardHeader>
              <CardTitle>{r.title}</CardTitle>
              <CardDescription>{r.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-fg-muted">Próximamente.</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
