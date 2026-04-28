import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Section,
} from '@segurasist/ui';
import { ArrowRight, BarChart3, FileSpreadsheet, LineChart as LineChartIcon } from 'lucide-react';
import { AccessDenied } from '../../_components/access-denied';
import { fetchMe } from '../../../lib/auth-server';
import { canAccess } from '../../../lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * S4-01/02/03 — Hub de Reportes.
 *
 * Server Component que gatea por RBAC y renderiza 3 cards-link a las
 * subpáginas: conciliación, volumetría, utilización. Consistencia con
 * `/insureds`, `/batches`, `/packages` (cada feature tiene un hub propio
 * cuando hay >1 view).
 */

interface ReportEntry {
  id: 'conciliacion' | 'volumetria' | 'utilizacion';
  href: '/reports/conciliacion' | '/reports/volumetria' | '/reports/utilizacion';
  title: string;
  description: string;
  Icon: typeof FileSpreadsheet;
}

const REPORTS: readonly ReportEntry[] = [
  {
    id: 'conciliacion',
    href: '/reports/conciliacion',
    title: 'Conciliación mensual',
    description:
      'Genera el reporte mensual filtrando por rango de fechas y entidad. Descarga PDF + XLSX.',
    Icon: FileSpreadsheet,
  },
  {
    id: 'volumetria',
    href: '/reports/volumetria',
    title: 'Volumetría',
    description: 'Tendencia diaria de altas, bajas y certificados emitidos en los últimos 90 días.',
    Icon: LineChartIcon,
  },
  {
    id: 'utilizacion',
    href: '/reports/utilizacion',
    title: 'Utilización por cobertura',
    description: 'Top consumidores y porcentaje de uso por paquete o cobertura.',
    Icon: BarChart3,
  },
];

export default async function ReportsPage() {
  const me = await fetchMe();
  if (!me.role || !canAccess('/reports', me.role)) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-4">
      <Section
        title="Reportes"
        description="Genera, descarga y analiza la actividad operativa."
      />
      <div className="grid gap-4 md:grid-cols-3">
        {REPORTS.map((r) => (
          <Card key={r.id} className="transition-colors hover:border-border-strong">
            <CardHeader>
              <div className="flex items-center gap-2">
                <r.Icon aria-hidden className="h-5 w-5 text-accent" />
                <CardTitle>{r.title}</CardTitle>
              </div>
              <CardDescription>{r.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href={r.href}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-accent transition-colors hover:text-accent-strong"
                aria-label={`Abrir ${r.title}`}
              >
                Abrir
                <ArrowRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
