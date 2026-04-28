'use client';

import * as React from 'react';
import { Bot } from 'lucide-react';

/**
 * S4-05 — Indicador "el asistente está escribiendo".
 *
 *  - 3 puntos animados con `animation-delay` escalonado (CSS keyframes
 *    locales para no depender de tailwind/animate plugin extra).
 *  - `aria-live="polite"` para que screen readers anuncien "el asistente
 *    está escribiendo" UNA VEZ — anunciarlo en cada animación sería
 *    intolerable.
 *  - `data-testid` para verificar en specs que aparece/desaparece.
 */
export function ChatbotTypingIndicator(): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="El asistente está escribiendo"
      data-testid="chatbot-typing-indicator"
      className="flex items-end gap-2"
    >
      <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-accent/15 text-accent">
        <Bot aria-hidden className="h-4 w-4" />
      </span>
      <div className="rounded-2xl rounded-bl-sm bg-surface px-3 py-2.5 shadow-sm">
        <span className="sr-only">El asistente está escribiendo…</span>
        <span className="flex items-center gap-1" aria-hidden>
          <Dot delay="0ms" />
          <Dot delay="150ms" />
          <Dot delay="300ms" />
        </span>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }): JSX.Element {
  // Inline keyframes via style tag local — evita extender tailwind config solo
  // por este indicator. El selector `.sa-chatbot-dot` es scoped por nombre.
  return (
    <span
      className="sa-chatbot-dot inline-block h-1.5 w-1.5 rounded-full bg-fg-muted"
      style={{
        animation: 'sa-chatbot-bounce 1s ease-in-out infinite',
        animationDelay: delay,
      }}
    />
  );
}
