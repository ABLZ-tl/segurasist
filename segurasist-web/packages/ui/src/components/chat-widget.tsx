'use client';

import * as React from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import { Button } from './button';
import { cn } from '../lib/cn';

export interface ChatSuggestion {
  id: string;
  label: string;
}

export interface ChatMessage {
  id: string;
  author: 'bot' | 'user';
  text: string;
  ts?: string;
}

export interface ChatWidgetProps {
  suggestions?: ChatSuggestion[];
  messages?: ChatMessage[];
  onSend?: (text: string) => void;
  onPickSuggestion?: (suggestion: ChatSuggestion) => void;
  className?: string;
  /** A11y label for the floating action button */
  triggerLabel?: string;
}

const DEFAULT_SUGGESTIONS: ChatSuggestion[] = [
  { id: 'q-vigencia', label: '¿Hasta cuándo es mi póliza?' },
  { id: 'q-cobertura', label: '¿Qué cubre mi paquete?' },
  { id: 'q-llamar', label: 'Quiero hablar con un agente' },
];

/**
 * Chatbot FAB + slide-up panel. Stateless wrt. transport: parent wires
 * suggestions, messages, and `onSend`. Always rendered at the bottom-right.
 */
export function ChatWidget({
  suggestions = DEFAULT_SUGGESTIONS,
  messages = [],
  onSend,
  onPickSuggestion,
  className,
  triggerLabel = 'Abrir asistente virtual',
}: ChatWidgetProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    onSend?.(text);
    setDraft('');
  };

  return (
    <div className={cn('fixed bottom-20 right-4 z-40 sm:bottom-6', className)}>
      {open && (
        <div
          role="dialog"
          aria-label="Asistente virtual"
          className="mb-3 flex h-[28rem] w-[min(20rem,calc(100vw-2rem))] flex-col rounded-lg border border-border bg-bg shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Asistente SegurAsist</h3>
            <button
              type="button"
              aria-label="Cerrar asistente"
              onClick={() => setOpen(false)}
              className="rounded p-1 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
            {messages.length === 0 && (
              <p className="text-fg-muted">
                Hola, soy el asistente de SegurAsist. ¿En qué puedo ayudarte hoy?
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'max-w-[80%] rounded-lg px-3 py-2',
                  m.author === 'bot'
                    ? 'bg-surface text-fg'
                    : 'ml-auto bg-primary text-primary-fg',
                )}
              >
                {m.text}
              </div>
            ))}
            {messages.length === 0 && suggestions.length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Sugerencias
                </p>
                <div className="flex flex-col gap-1">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onPickSuggestion?.(s)}
                      className="rounded-md border border-border bg-bg px-3 py-2 text-left text-sm hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <form
            className="flex items-center gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <label htmlFor="chat-draft" className="sr-only">
              Escribe tu mensaje
            </label>
            <input
              id="chat-draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Escribe tu mensaje..."
              className="flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" size="icon" aria-label="Enviar mensaje">
              <Send aria-hidden className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}

      <Button
        type="button"
        size="icon"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen((v) => !v)}
        className="h-14 w-14 rounded-full shadow-lg"
      >
        {open ? <X aria-hidden className="h-6 w-6" /> : <MessageCircle aria-hidden className="h-6 w-6" />}
      </Button>
    </div>
  );
}
