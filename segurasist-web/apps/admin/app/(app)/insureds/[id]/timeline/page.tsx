/**
 * S4-09 — Página dedicada al timeline de auditoría del asegurado.
 *
 * Pantalla full-width (out-of-tab) que sirve para investigaciones largas
 * donde el tab compacto de la vista 360 queda corto. Replica el componente
 * `AuditTimeline` con el botón de export visible.
 *
 * Server Component thin wrapper — la lógica vive en el client component.
 */
import { Section, Breadcrumbs } from '@segurasist/ui';
import { AuditTimeline } from '../../../../../components/audit-timeline';

interface PageProps {
  params: { id: string };
}

export default function InsuredTimelinePage({ params }: PageProps) {
  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { label: 'Inicio', href: '/dashboard' },
          { label: 'Asegurados', href: '/insureds' },
          { label: 'Asegurado', href: `/insureds/${params.id}` },
          { label: 'Timeline' },
        ]}
      />
      <Section
        title="Timeline de auditoría"
        description="Eventos completos del asegurado, ordenados del más reciente al más antiguo."
      >
        <AuditTimeline insuredId={params.id} />
      </Section>
    </div>
  );
}
