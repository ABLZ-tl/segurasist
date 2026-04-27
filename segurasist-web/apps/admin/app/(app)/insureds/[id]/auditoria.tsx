'use client';

/**
 * S3-06 — Tab "Auditoría" de la vista 360.
 *
 * Timeline con avatar de actor + action humano-legible + timestamp + IP. Cada
 * entry es expandible para ver `payloadDiff` en JSON formateado. Paginación
 * NO se hace en este tab — el endpoint 360 ya devuelve los últimos 50, que
 * cubren ~la mayoría de uso ad-hoc del admin. La paginación cursor-based para
 * el detalle completo vive en `/audit/log` (S2 cerró ese endpoint).
 *
 * Export CSV: link al endpoint `/v1/audit/log?resourceType=insureds&resourceId=...`
 * que el backend ya soporta. No requiere componente nuevo.
 */

import * as React from 'react';
import { Avatar, AvatarFallback, EmptyState, Section, initialsOf } from '@segurasist/ui';
import type { Insured360 } from '../../../../lib/hooks/use-insured-360';

interface Props {
  audit: Insured360['audit'];
  insuredId: string;
}

function humanizeAction(action: string, payloadDiff: Record<string, unknown> | null): string {
  if (action === 'read' && payloadDiff && payloadDiff['subAction'] === 'viewed_360') {
    return 'Vió la ficha 360';
  }
  switch (action) {
    case 'create':
      return 'Creó el registro';
    case 'update':
      return 'Editó el registro';
    case 'delete':
      return 'Eliminó el registro';
    case 'reissue':
      return 'Reemitió certificado';
    case 'export':
      return 'Exportó datos';
    case 'login':
      return 'Inició sesión';
    case 'logout':
      return 'Cerró sesión';
    case 'read':
      return 'Consultó';
    default:
      return action;
  }
}

function maskIp(ip: string): string {
  if (!ip) return '';
  // IPv4 → x.x.x.* / IPv6 → primeros 2 grupos. Reduce huella PII en pantalla.
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}::*`;
  }
  return ip;
}

function AuditEntry({ entry }: { entry: Insured360['audit'][number] }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const actor = entry.actorEmail || 'sistema';
  const action = humanizeAction(entry.action, entry.payloadDiff);
  const ip = maskIp(entry.ip);
  return (
    <li className="flex gap-3">
      <Avatar>
        <AvatarFallback>{initialsOf(actor)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm">
          <span className="font-medium">{actor}</span> · {action}
        </p>
        <p className="text-xs text-fg-muted">
          {new Date(entry.occurredAt).toLocaleString('es-MX')}
          {ip ? ` · IP ${ip}` : ''}
        </p>
        {entry.payloadDiff && (
          <button
            type="button"
            className="text-xs text-accent underline-offset-2 hover:underline"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? 'Ocultar diff' : 'Ver diff'}
          </button>
        )}
        {open && entry.payloadDiff && (
          <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-border bg-surface p-2 text-xs">
            {JSON.stringify(entry.payloadDiff, null, 2)}
          </pre>
        )}
      </div>
    </li>
  );
}

export function InsuredAuditoriaTab({ audit, insuredId }: Props): React.ReactElement {
  const exportHref = `/api/proxy/v1/audit/log?resourceType=insureds&resourceId=${insuredId}&format=csv`;
  return (
    <Section
      actions={
        <a
          href={exportHref}
          className="text-sm text-accent underline-offset-2 hover:underline"
          data-testid="audit-export-link"
        >
          Exportar CSV
        </a>
      }
    >
      {audit.length === 0 ? (
        <EmptyState title="Sin actividad registrada." description="Aún no hay eventos de auditoría para este asegurado." />
      ) : (
        <ol className="space-y-4" data-testid="audit-timeline">
          {audit.map((entry) => (
            <AuditEntry key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
    </Section>
  );
}
