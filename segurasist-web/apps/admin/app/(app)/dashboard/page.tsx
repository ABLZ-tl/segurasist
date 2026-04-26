import { TrendChart, CertsByDayChart } from './charts';
import { DashboardTables } from './dashboard-tables';
import { KpiGrid } from './kpi-grid';
import { fetchMe } from '../../../lib/auth-server';

export const metadata = { title: 'Resumen' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { email } = await fetchMe();
  return (
    <div className="space-y-6 lg:space-y-8">
      <header className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">Hospitales MAC</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tightest text-fg lg:text-3xl">Resumen</h1>
        </div>
        <p className="text-sm text-fg-muted">
          {email ? (
            <>
              Sesión iniciada como <span className="font-medium text-fg">{email}</span>
            </>
          ) : (
            'Resumen al 25 de abril de 2026'
          )}
        </p>
      </header>

      <KpiGrid />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ChartCard title="Altas y bajas" description="Últimas 12 semanas">
          <TrendChart />
        </ChartCard>
        <ChartCard title="Certificados emitidos" description="Por día — últimos 14 días">
          <CertsByDayChart />
        </ChartCard>
      </div>

      <DashboardTables />
    </div>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-bg">
      <header className="flex items-baseline justify-between border-b border-border px-4 py-3 sm:px-5">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold tracking-tighter text-fg lg:text-lg">{title}</h2>
          <p className="text-[12px] text-fg-subtle">{description}</p>
        </div>
      </header>
      <div className="px-2 py-3 sm:px-5 sm:py-4">{children}</div>
    </section>
  );
}
