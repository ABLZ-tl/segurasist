'use client';

/**
 * Sprint 5 — S5-3 finisher.
 *
 * <ConversationThreadDrawer /> — sheet derecho que muestra el thread
 * completo de una conversación, read-only.
 *
 * UX:
 *   - Reusa `<ChatbotMessageBubble>` existente (S4-05) para mantener un
 *     único look del bot/usuario en todo el portal.
 *   - Scroll auto al fondo cuando la lista termina de cargar.
 *   - Skeleton mientras carga; AlertBanner si error.
 *   - PageTransition envolvente para un slide-in animado (350ms ease).
 *
 * El BE devuelve mensajes en orden cronológico (created_at ASC). Los
 * normalizamos al shape `ChatbotMessage` que el bubble component espera
 * (`author`, `text`, `ts`, `id`).
 */

import * as React from 'react';
import {
  AlertBanner,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from '@segurasist/ui';
import { useChatbotConversationMessages } from '@segurasist/api-client/hooks/chatbot-history';
import type { ConversationMessage } from '@segurasist/api-client/hooks/chatbot-history';
import { ChatbotMessageBubble } from '../../../../components/chatbot/chatbot-message';
import type { ChatbotMessage } from '../../../../components/chatbot/chatbot-store';

export interface ConversationThreadDrawerProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function toBubbleMessage(m: ConversationMessage): ChatbotMessage {
  return {
    id: m.id,
    author: m.role,
    text: m.content,
    ts: m.createdAt,
  };
}

export function ConversationThreadDrawer({
  conversationId,
  open,
  onOpenChange,
}: ConversationThreadDrawerProps): JSX.Element {
  const { data, isLoading, isError, error } = useChatbotConversationMessages(
    conversationId ?? '',
    { limit: 200, offset: 0 },
  );

  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!data || !scrollRef.current) return;
    // Scroll al fondo cuando se carga el thread.
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [data]);

  const messages = data?.items ?? [];
  const now = React.useMemo(() => new Date().toISOString(), [data]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full max-w-xl flex-col overflow-hidden p-0 sm:max-w-xl"
        data-testid="conversation-thread-drawer"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle>Conversación</SheetTitle>
          <SheetDescription>
            Histórico read-only. Para nuevas dudas usa el chatbot del portal.
          </SheetDescription>
        </SheetHeader>

        <div
          ref={scrollRef}
          data-testid="conversation-thread-scroll"
          className="flex-1 overflow-y-auto px-5 py-4"
        >
          {isLoading && (
            <div data-testid="conversation-thread-skeleton" className="space-y-3">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-10 w-2/3 ml-auto" />
              <Skeleton className="h-10 w-3/4" />
            </div>
          )}

          {isError && (
            <AlertBanner tone="danger" title="No pudimos cargar el thread">
              {error instanceof Error
                ? error.message
                : 'Reintenta en unos segundos.'}
            </AlertBanner>
          )}

          {!isLoading && !isError && messages.length === 0 && (
            <p className="text-sm text-fg-muted">
              Esta conversación no tiene mensajes registrados.
            </p>
          )}

          {!isLoading && !isError && messages.length > 0 && (
            <div className="space-y-3">
              {messages.map((m) => (
                <ChatbotMessageBubble
                  key={m.id}
                  message={toBubbleMessage(m)}
                  now={now}
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
