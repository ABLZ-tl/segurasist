'use client';

import * as React from 'react';
import { MessageCircle } from 'lucide-react';
import { toast } from '@segurasist/ui';

/**
 * Chat FAB — placeholder for the Sprint 4 virtual assistant.
 *
 * Sits above the bottom nav (`bottom-[88px]`) so it never covers a tab. On
 * click it surfaces a friendly toast informing the user the feature is on
 * the way; once the assistant lands we'll wire this to open the drawer.
 */
export function ChatFab(): JSX.Element {
  const onClick = (): void => {
    toast.message('Asistente virtual disponible próximamente', {
      description: 'Estamos preparando un asistente inteligente para ti.',
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Abrir asistente virtual"
      data-testid="portal-chat-fab"
      className="fixed right-4 bottom-[88px] z-40 grid h-14 w-14 min-h-[44px] min-w-[44px] place-items-center rounded-full bg-accent text-accent-fg shadow-lg ring-1 ring-accent/30 transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <MessageCircle aria-hidden className="h-6 w-6" />
    </button>
  );
}
