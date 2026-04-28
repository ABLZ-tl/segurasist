'use client';

/**
 * S4-09 — Item individual del timeline.
 *
 * Layout:
 *   - Dot + connecting line a la izquierda (CSS pseudo-elements del padre).
 *   - Icon según action type (lucide-react).
 *   - Header: actor (avatar + name) + acción humana + timestamp relative.
 *   - Tooltip con timestamp absoluto (ISO) sobre el relative.
 *   - Body expandible con payloadDiff JSON (defaults collapsed).
 *
 * Accesibilidad:
 *   - Cada item es `role="article"` dentro del `role="feed"` del timeline.
 *   - El botón "ver/ocultar diff" lleva `aria-expanded`.
 *   - Iconos `aria-hidden` (la acción humana ya describe semánticamente).
 */
import * as React from 'react';
import {
  Activity,
  Download,
  Eye,
  FileSignature,
  Lock,
  LogIn,
  LogOut,
  Pencil,
  PlusCircle,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Avatar, AvatarFallback, initialsOf } from '@segurasist/ui';
import type { AuditTimelineItem as ItemDto } from '@segurasist/api-client/hooks/audit-timeline';

interface Props {
  entry: ItemDto;
}

/**
 * Mapea la action canónica a un icono lucide. `read_viewed` y `read_downloaded`
 * son sub-tipos de read (F6 iter 2 enum extend) — distinguimos en el icon.
 */
function iconForAction(action: string): React.ReactElement {
  const cls = 'h-4 w-4 text-accent';
  switch (action) {
    case 'create':
      return <PlusCircle aria-hidden className={cls} />;
    case 'update':
      return <Pencil aria-hidden className={cls} />;
    case 'delete':
      return <Trash2 aria-hidden className={cls} />;
    case 'read':
    case 'read_viewed':
      return <Eye aria-hidden className={cls} />;
    case 'read_downloaded':
    case 'export':
    case 'export_downloaded':
      return <Download aria-hidden className={cls} />;
    case 'login':
      return <LogIn aria-hidden className={cls} />;
    case 'logout':
      return <LogOut aria-hidden className={cls} />;
    case 'reissue':
      return <FileSignature aria-hidden className={cls} />;
    case 'otp_requested':
      return <Lock aria-hidden className={cls} />;
    case 'otp_verified':
      return <ShieldCheck aria-hidden className={cls} />;
    default:
      return <Activity aria-hidden className={cls} />;
  }
}

function humanizeAction(action: string): string {
  switch (action) {
    case 'create':
      return 'Creó el registro';
    case 'update':
      return 'Editó el registro';
    case 'delete':
      return 'Eliminó el registro';
    case 'read':
      return 'Consultó';
    case 'read_viewed':
      return 'Vió la ficha 360';
    case 'read_downloaded':
      return 'Descargó información';
    case 'reissue':
      return 'Reemitió certificado';
    case 'export':
      return 'Exportó datos';
    case 'export_downloaded':
      return 'Descargó export CSV';
    case 'login':
      return 'Inició sesión';
    case 'logout':
      return 'Cerró sesión';
    case 'otp_requested':
      return 'Solicitó OTP';
    case 'otp_verified':
      return 'Verificó OTP';
    default:
      return action;
  }
}

/**
 * Formatea timestamp como "hace X" (relative). Sin librerías externas: en
 * Sprint 5 se puede swapear por `date-fns/formatDistanceToNowStrict`.
 */
function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `hace ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `hace ${mo} meses`;
  return `hace ${Math.floor(mo / 12)} años`;
}

export function AuditTimelineItem({ entry }: Props): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const actor = entry.actorEmail || entry.actorId || 'sistema';
  const action = humanizeAction(entry.action);
  const absTs = new Date(entry.occurredAt).toLocaleString('es-MX');
  const relTs = relativeTime(entry.occurredAt);
  const hasDiff =
    entry.payloadDiff !== null &&
    entry.payloadDiff !== undefined &&
    !(typeof entry.payloadDiff === 'object' &&
      !Array.isArray(entry.payloadDiff) &&
      Object.keys(entry.payloadDiff as object).length === 0);

  return (
    <li
      role="article"
      aria-label={`${actor} ${action} ${relTs}`}
      data-testid="audit-timeline-item"
      className="relative flex gap-3 pb-6 last:pb-0"
    >
      {/* Dot + linea vertical (la línea la pinta el contenedor en ::before del primer/último ajuste). */}
      <div className="flex flex-col items-center" aria-hidden>
        <span className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface">
          {iconForAction(entry.action)}
        </span>
        <span className="mt-1 w-px flex-1 bg-border" />
      </div>

      <div className="min-w-0 flex-1 space-y-1 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <Avatar className="h-6 w-6">
            <AvatarFallback className="text-[10px]">{initialsOf(actor)}</AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium text-fg">{actor}</span>
          <span className="text-sm text-fg-muted">{action}</span>
        </div>
        <p className="text-xs text-fg-muted">
          <time
            dateTime={entry.occurredAt}
            title={absTs}
            data-testid="audit-timeline-item-timestamp"
          >
            {relTs}
          </time>
          {entry.ipMasked ? ` · IP ${entry.ipMasked}` : ''}
          {entry.resourceType ? ` · ${entry.resourceType}` : ''}
        </p>
        {hasDiff && (
          <button
            type="button"
            className="text-xs text-accent underline-offset-2 hover:underline"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            data-testid="audit-timeline-item-toggle"
          >
            {open ? 'Ocultar detalle' : 'Ver detalle'}
          </button>
        )}
        {open && hasDiff && (
          <pre
            data-testid="audit-timeline-item-diff"
            className="mt-1 max-h-64 overflow-auto rounded-md border border-border bg-surface p-2 text-xs"
          >
            {JSON.stringify(entry.payloadDiff, null, 2)}
          </pre>
        )}
      </div>
    </li>
  );
}
