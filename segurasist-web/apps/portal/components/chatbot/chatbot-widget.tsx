'use client';

/**
 * S4-05 / S4-08 — Widget chatbot del portal asegurado.
 *
 * Componente top-level que:
 *  1. Renderiza un FAB persistente esquina inferior derecha (mobile-first
 *     50x50, desktop 60x60).
 *  2. Al expandir, muestra un panel `role="dialog"`:
 *     - mobile (<640px): full-width drawer desde abajo, altura 80vh.
 *     - desktop (≥640px): floating card 380x540 anclado abajo-derecha.
 *  3. Pinta header (avatar + título + close), lista de mensajes + typing
 *     indicator, footer con textarea + send + "hablar con humano".
 *  4. Persiste la conversación entre páginas via `useChatbotStore` +
 *     `localStorage` (TTL 7d).
 *  5. A11y: dialog modal con focus trap nativo del browser (basado en
 *     `aria-modal` + `tabindex`); cierra con Esc; aria-live="polite" en
 *     la lista de mensajes; aria-busy en el escalate button.
 *
 * Coordinación S5/S6:
 *  - S5 (KB): el shape de la response viene como `{ reply, conversationId,
 *    messageId, ts }`. Si S5 cambia, ajustar `useSendChatMessage` types
 *    en iter 2 sin tocar este componente.
 *  - S6 (personalization): puede agregar `policyExpiresAt`, `packageName`
 *    a la response. Hoy las ignoramos; iter 2 podríamos pintar sub-bubble
 *    con esos hints.
 *
 * Auth gate:
 *  - El layout `(app)/layout.tsx` ya está detrás del middleware del portal,
 *    que redirige a `/login` si no hay cookie. Por tanto cualquier render
 *    de este widget garantiza usuario autenticado. El prop `enabled` deja
 *    una salida de emergencia si en el futuro queremos esconder el widget
 *    para ciertos roles.
 */

import * as React from 'react';
import { MessageCircle, X, Bot } from 'lucide-react';
import { toast } from '@segurasist/ui';
import {
  useSendChatMessage,
  useEscalateConversation,
} from '@segurasist/api-client/hooks/chatbot';
import { useChatbotStore, type ChatbotMessage } from './chatbot-store';
import { ChatbotMessageBubble } from './chatbot-message';
import { ChatbotInput } from './chatbot-input';
import { ChatbotTypingIndicator } from './chatbot-typing-indicator';

export interface ChatbotWidgetProps {
  /** Si false, el widget no se renderiza (no autenticado, feature flag off). */
  enabled?: boolean;
}

const WELCOME_TEXT =
  'Hola, soy el asistente de SegurAsist. Pregúntame sobre tu póliza, coberturas o cómo reportar un siniestro.';

export function ChatbotWidget({ enabled = true }: ChatbotWidgetProps): JSX.Element | null {
  const open = useChatbotStore((s) => s.open);
  const messages = useChatbotStore((s) => s.messages);
  const pending = useChatbotStore((s) => s.pending);
  const conversationId = useChatbotStore((s) => s.conversationId);
  const escalatedTicketId = useChatbotStore((s) => s.escalatedTicketId);
  const setOpen = useChatbotStore((s) => s.setOpen);
  const appendMessage = useChatbotStore((s) => s.appendMessage);
  const setConversationId = useChatbotStore((s) => s.setConversationId);
  const setPending = useChatbotStore((s) => s.setPending);
  const markEscalated = useChatbotStore((s) => s.markEscalated);
  const hydrateFromStorage = useChatbotStore((s) => s.hydrateFromStorage);

  const sendMutation = useSendChatMessage();
  const escalateMutation = useEscalateConversation();

  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  // Hidratación post-mount (SSR-safe).
  React.useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  // Auto-scroll al fondo cuando llega un mensaje nuevo o aparece typing.
  React.useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [open, messages.length, pending]);

  // Esc cierra el panel.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!enabled) return null;

  const handleSend = async (text: string): Promise<void> => {
    const userMsg: ChatbotMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      author: 'user',
      text,
      ts: new Date().toISOString(),
    };
    appendMessage(userMsg);
    setPending(true);

    try {
      const reply = await sendMutation.mutateAsync({
        message: text,
        ...(conversationId ? { conversationId } : {}),
      });
      if (reply.conversationId && reply.conversationId !== conversationId) {
        setConversationId(reply.conversationId);
      }
      appendMessage({
        id: reply.messageId ?? `bot-${Date.now()}`,
        author: 'bot',
        text: reply.response ?? reply.reply ?? '',
        ts: reply.ts ?? new Date().toISOString(),
      });
    } catch (err) {
      // No insertamos el error como bubble del bot — confunde al usuario y
      // deja un mensaje "fallido" persistido. En su lugar:
      //  1. Toast efímero (sonner) para feedback inmediato.
      //  2. System bubble in-line para que el usuario sepa que reintente.
      const detail = err instanceof Error ? err.message : 'Error desconocido';
      toast.error('No pude enviar tu mensaje', { description: detail });
      appendMessage({
        id: `sys-${Date.now()}`,
        author: 'system',
        text: 'No pudimos contactar al asistente. Inténtalo de nuevo en un momento.',
        ts: new Date().toISOString(),
      });
    } finally {
      setPending(false);
    }
  };

  const handleEscalate = async (): Promise<void> => {
    if (!conversationId) {
      // Nunca escalamos sin conversación — el backend necesita el contexto.
      toast.message('Envía primero un mensaje', {
        description:
          'Cuéntame qué necesitas; con esa información creamos el ticket para un agente.',
      });
      return;
    }
    try {
      const result = await escalateMutation.mutateAsync({ conversationId });
      const ticketRef = result.ticketId ?? result.conversationId;
      const ackQueued = result.acknowledgementSentToInsured ?? result.ackEmailQueued ?? false;
      markEscalated(ticketRef);
      appendMessage({
        id: `sys-esc-${ticketRef}`,
        author: 'system',
        text: ackQueued
          ? `Ticket ${ticketRef} creado. Recibirás un correo de confirmación y un agente se pondrá en contacto.`
          : `Ticket ${ticketRef} creado. Un agente se pondrá en contacto pronto.`,
        ts: new Date().toISOString(),
      });
      toast.success('Ticket creado', {
        description: `Folio ${ticketRef}. Un agente te contactará.`,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Error desconocido';
      toast.error('No pude crear el ticket', { description: detail });
    }
  };

  const showWelcome = messages.length === 0;

  return (
    <>
      {/* Floating Action Button — siempre visible, persistente entre páginas. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="sa-chatbot-panel"
        aria-label={open ? 'Cerrar asistente virtual' : 'Abrir asistente virtual'}
        data-testid="chatbot-fab"
        className={`fixed right-4 bottom-[88px] z-40 grid h-[50px] w-[50px] place-items-center rounded-full bg-accent text-accent-fg shadow-lg ring-1 ring-accent/30 transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:right-6 sm:bottom-6 sm:h-[60px] sm:w-[60px] ${
          open ? 'sm:opacity-0 sm:pointer-events-none' : ''
        }`}
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        {open ? (
          <X aria-hidden className="h-6 w-6" />
        ) : (
          <MessageCircle aria-hidden className="h-6 w-6" />
        )}
      </button>

      {/* Backdrop desktop — escondido en mobile (drawer ocupa 80vh). */}
      {open && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 hidden bg-fg/30 backdrop-blur-[2px] sm:block"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel principal */}
      {open && (
        <div
          ref={dialogRef}
          id="sa-chatbot-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sa-chatbot-title"
          data-testid="chatbot-panel"
          className="fixed z-50 flex flex-col overflow-hidden rounded-t-2xl border border-border bg-bg shadow-2xl
                     inset-x-0 bottom-0 h-[80vh] max-h-[640px]
                     sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[540px] sm:w-[380px] sm:rounded-2xl"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {/* Header */}
          <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-fg">
                <Bot aria-hidden className="h-5 w-5" />
              </span>
              <div className="flex flex-col leading-tight">
                <span
                  id="sa-chatbot-title"
                  className="text-sm font-semibold text-fg"
                >
                  Asistente SegurAsist
                </span>
                <span className="text-[11px] text-fg-muted">
                  {pending ? 'Escribiendo…' : 'En línea'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar asistente"
              data-testid="chatbot-close"
              className="grid h-8 w-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-bg hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </header>

          {/* Banner de ticket creado (sticky bajo header) */}
          {escalatedTicketId && (
            <div
              role="status"
              data-testid="chatbot-escalated-banner"
              className="border-b border-success/30 bg-success/10 px-4 py-2 text-xs text-fg"
            >
              Ticket <strong className="font-semibold">{escalatedTicketId}</strong>{' '}
              creado. Recibirás respuesta por correo.
            </div>
          )}

          {/* Lista de mensajes */}
          <div
            aria-live="polite"
            aria-label="Conversación con el asistente"
            data-testid="chatbot-messages"
            className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
          >
            {showWelcome && (
              <ChatbotMessageBubble
                message={{
                  id: 'welcome',
                  author: 'bot',
                  text: WELCOME_TEXT,
                  ts: new Date().toISOString(),
                }}
              />
            )}
            {messages.map((m) => (
              <ChatbotMessageBubble key={m.id} message={m} />
            ))}
            {pending && <ChatbotTypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Footer: input + escalate */}
          <ChatbotInput
            onSend={(text) => {
              void handleSend(text);
            }}
            onEscalate={() => {
              void handleEscalate();
            }}
            disabled={pending}
            escalating={escalateMutation.isPending}
            escalateDisabled={!!escalatedTicketId}
          />
        </div>
      )}

      {/* Keyframes locales para el typing indicator. Inyectados una sola vez
          con `key` estático — Next ya garantiza que <ChatbotWidget /> es
          singleton en el layout. */}
      <style jsx global>{`
        @keyframes sa-chatbot-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-3px); opacity: 1; }
        }
      `}</style>
    </>
  );
}
