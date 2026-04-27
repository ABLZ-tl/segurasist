'use client';

/**
 * S3-06 — Tab "Eventos" (claims/siniestros) de la vista 360.
 *
 * Timeline vertical en orden cronológico inverso. Cada item: fecha + tipo +
 * descripción + status badge + amountEstimated MXN. Botón "+ Nuevo evento"
 * arriba — abre modal en Sprint 4 (placeholder noop por ahora).
 */

import * as React from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, EmptyState, Section } from '@segurasist/ui';
import type { Insured360 } from '../../../../lib/hooks/use-insured-360';

interface Props {
  events: Insured360['events'];
}

function statusVariant(s: string): 'success' | 'warning' | 'danger' | 'default' {
  switch (s) {
    case 'paid':
    case 'approved':
      return 'success';
    case 'in_review':
    case 'reported':
      return 'warning';
    case 'rejected':
      return 'danger';
    default:
      return 'default';
  }
}

function fmtMxn(v: number | null): string {
  if (v === null) return '—';
  return v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

export function InsuredEventosTab({ events }: Props): React.ReactElement {
  return (
    <Section
      actions={
        <Button size="sm" data-testid="event-new-btn" disabled>
          <Plus aria-hidden className="mr-1 h-4 w-4" />
          Nuevo evento
        </Button>
      }
    >
      {events.length === 0 ? (
        <EmptyState title="Sin siniestros reportados." description="Aún no se han reportado siniestros para este asegurado." />
      ) : (
        <ol className="relative ml-3 space-y-4 border-l border-border pl-6" data-testid="events-timeline">
          {events.map((ev) => (
            <li key={ev.id} className="relative">
              <span
                aria-hidden
                className="absolute -left-[33px] mt-1.5 h-3 w-3 rounded-full border-2 border-bg bg-accent"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{ev.type}</span>
                  <Badge variant={statusVariant(ev.status)}>{ev.status}</Badge>
                  <span className="ml-auto text-xs text-fg-muted">
                    {new Date(ev.reportedAt).toLocaleString('es-MX')}
                  </span>
                </div>
                <p className="text-sm text-fg-muted">{ev.description}</p>
                <p className="text-xs text-fg-muted">Estimado: {fmtMxn(ev.amountEstimated)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
