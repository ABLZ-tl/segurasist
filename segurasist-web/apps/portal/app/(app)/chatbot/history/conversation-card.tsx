'use client';

/**
 * Sprint 5 — S5-3 finisher.
 *
 * <ConversationCard /> — card individual del histórico chatbot.
 *
 * UX:
 *   - rounded 12px, shadow soft, padding 16px, hover lift
 *     (translate-y-[-2px]) + shadow-md.
 *   - Última actividad en formato relativo es-MX (`hace X min/h/d`).
 *   - Preview truncado a 80 chars con `…`.
 *   - Badge de estado: escalada=info, resuelta=success, abierta=neutral.
 *   - Touch target ≥44px (height min controlado por padding).
 *
 * El click llama `onSelect(conversation.id)` — el parent (history-client.tsx)
 * abre el drawer con el thread.
 */

import * as React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from '@segurasist/ui';
import type { ConversationListItem } from '@segurasist/api-client/hooks/chatbot-history';

export interface ConversationCardProps {
  conversation: ConversationListItem;
  onSelect: (id: string) => void;
}

const PREVIEW_LIMIT = 80;

function statusLabel(status: ConversationListItem['status']): string {
  switch (status) {
    case 'escalated':
      return 'Escalada';
    case 'closed':
      return 'Resuelta';
    default:
      return 'Abierta';
  }
}

function statusVariant(
  status: ConversationListItem['status'],
): 'success' | 'secondary' | 'default' {
  switch (status) {
    case 'escalated':
      return 'default';
    case 'closed':
      return 'success';
    default:
      return 'secondary';
  }
}

function statusDotColor(status: ConversationListItem['status']): string {
  switch (status) {
    case 'escalated':
      return 'bg-accent';
    case 'closed':
      return 'bg-success';
    default:
      return 'bg-fg-muted';
  }
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

export function ConversationCard({
  conversation,
  onSelect,
}: ConversationCardProps): JSX.Element {
  const rel = (() => {
    try {
      return formatDistanceToNow(new Date(conversation.lastActivityAt), {
        addSuffix: true,
        locale: es,
      });
    } catch {
      return '—';
    }
  })();

  const preview = truncate(conversation.lastMessagePreview, PREVIEW_LIMIT);
  const status = conversation.status;

  return (
    <button
      type="button"
      data-testid="conversation-card"
      data-conversation-id={conversation.id}
      onClick={() => onSelect(conversation.id)}
      className="group flex w-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-[2px] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <span
            aria-hidden
            className={[
              'inline-block h-2 w-2 rounded-full',
              statusDotColor(status),
            ].join(' ')}
          />
          <Badge variant={statusVariant(status)} data-testid="conversation-card-status">
            {statusLabel(status)}
          </Badge>
        </div>
        <span className="text-xs text-fg-muted" data-testid="conversation-card-time">
          {rel}
        </span>
      </div>
      <p
        data-testid="conversation-card-preview"
        className="text-sm text-fg leading-snug"
      >
        {preview || (
          <span className="italic text-fg-muted">Sin mensajes recientes.</span>
        )}
      </p>
      <div className="text-xs text-fg-muted">
        {conversation.messageCount}{' '}
        {conversation.messageCount === 1 ? 'mensaje' : 'mensajes'}
      </div>
    </button>
  );
}
