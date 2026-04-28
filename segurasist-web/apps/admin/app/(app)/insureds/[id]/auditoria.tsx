'use client';

/**
 * S4-09 — Tab "Auditoría" de la vista 360.
 *
 * Reemplaza la implementación inline del Sprint 3 (S3-06) que listaba los
 * últimos 50 audit rows del payload `/v1/insureds/:id/360`. Ahora delega al
 * componente `<AuditTimeline insuredId={id} />` que pega contra
 * `/v1/audit/timeline?insuredId=...&cursor=...&limit=20` con paginación
 * cursor-based + scroll infinito + filtros + export CSV streamed.
 *
 * El prop `audit` legacy se mantiene en la signature para compatibilidad
 * binaria con `Insured360Client` (que sigue pasándolo desde el endpoint
 * `/360`); en este componente se ignora — el timeline tiene su propio
 * data flow vía `useAuditTimeline`.
 */

import * as React from 'react';
import { Section } from '@segurasist/ui';
import { AuditTimeline } from '../../../../components/audit-timeline';
import type { Insured360 } from '../../../../lib/hooks/use-insured-360';

interface Props {
  /** Mantenido para compat con `Insured360Client`; deprecated en S4-09. */
  audit?: Insured360['audit'];
  insuredId: string;
}

export function InsuredAuditoriaTab({ insuredId }: Props): React.ReactElement {
  return (
    <Section>
      <AuditTimeline insuredId={insuredId} />
    </Section>
  );
}
