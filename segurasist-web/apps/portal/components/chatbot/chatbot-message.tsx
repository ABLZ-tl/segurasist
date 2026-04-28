'use client';

import * as React from 'react';
import { Bot, User, AlertCircle } from 'lucide-react';
import type { ChatbotMessage } from './chatbot-store';

export interface ChatbotMessageProps {
  message: ChatbotMessage;
  /** ISO ahora — pasado por el padre para evitar `new Date()` en cada render. */
  now?: string;
}

/**
 * S4-05 — Burbuja de mensaje individual.
 *
 *  - Bot a la izquierda con avatar (icono Bot), bg-surface.
 *  - Usuario a la derecha sin avatar, bg-accent text-accent-fg.
 *  - System (errores / banners): centrado, ancho máximo 90%, fondo warning-soft.
 *  - Timestamp relativo abajo de cada bubble (`hace X min`); si <1 min muestra
 *    "ahora". Mobile-first: max-width 80% del panel.
 *  - A11y: cada bubble es un `role="article"` con `aria-label` que incluye
 *    autor + timestamp para screen readers (los emoji decorativos llevan
 *    `aria-hidden`).
 */
export function ChatbotMessageBubble({ message, now }: ChatbotMessageProps): JSX.Element {
  const relTs = formatRelative(message.ts, now);
  const isBot = message.author === 'bot';
  const isUser = message.author === 'user';
  const isSystem = message.author === 'system';

  if (isSystem) {
    return (
      <div
        role="status"
        aria-label={`Aviso del sistema: ${message.text}`}
        className="mx-auto flex w-[90%] items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-fg"
        data-testid="chatbot-message-system"
      >
        <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 flex-none text-warning" />
        <p className="leading-snug">{message.text}</p>
      </div>
    );
  }

  return (
    <div
      role="article"
      aria-label={`${isBot ? 'Asistente' : 'Tú'}, ${relTs}: ${message.text}`}
      data-testid={isBot ? 'chatbot-message-bot' : 'chatbot-message-user'}
      className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {isBot && (
        <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-accent/15 text-accent">
          <Bot aria-hidden className="h-4 w-4" />
        </span>
      )}

      <div
        className={`flex max-w-[80%] flex-col gap-0.5 ${
          isUser ? 'items-end' : 'items-start'
        }`}
      >
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-snug shadow-sm ${
            isBot
              ? 'rounded-bl-sm bg-surface text-fg'
              : 'rounded-br-sm bg-accent text-accent-fg'
          }`}
        >
          {message.text}
        </div>
        <span className="px-1 text-[10px] text-fg-subtle">{relTs}</span>
      </div>

      {isUser && (
        <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-accent text-accent-fg">
          <User aria-hidden className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}

/**
 * Formato relativo en español muy compacto. Centralizado aquí para no
 * importar `date-fns/formatDistanceToNow` solo por esto (~14 KB) — el
 * widget tiene que ser ligero, especialmente en mobile.
 */
function formatRelative(ts: string, now?: string): string {
  const then = new Date(ts).getTime();
  const ref = now ? new Date(now).getTime() : Date.now();
  if (Number.isNaN(then) || Number.isNaN(ref)) return '';
  const diffSec = Math.max(0, Math.floor((ref - then) / 1000));
  if (diffSec < 60) return 'ahora';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  return `hace ${diffD} d`;
}
