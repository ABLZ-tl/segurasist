import { fetchMe } from '../../../lib/auth-server';
import { DashboardClient } from './dashboard-client';

export const metadata = { title: 'Resumen' };
export const dynamic = 'force-dynamic';

/**
 * S2-05 — Dashboard server entrypoint.
 *
 * Hace un round-trip a `/v1/auth/me` (server side) sólo para mostrar el
 * email de la sesión en el header. El resto (KPIs, charts, tables) lo
 * fetchea el client component vía TanStack Query con auto-refresh 60s.
 */
export default async function DashboardPage() {
  const { email } = await fetchMe();
  return (
    <div className="space-y-6 lg:space-y-8">
      <header className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
          Hospitales MAC
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tightest text-fg lg:text-3xl">Resumen</h1>
        </div>
        <p className="text-sm text-fg-muted">
          {email ? (
            <>
              Sesión iniciada como <span className="font-medium text-fg">{email}</span>
            </>
          ) : (
            'Resumen en tiempo real'
          )}
        </p>
      </header>

      <DashboardClient />
    </div>
  );
}
