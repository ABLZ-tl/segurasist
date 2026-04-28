'use client';

import * as React from 'react';
import { Send, UserCog, Loader2 } from 'lucide-react';

export interface ChatbotInputProps {
  onSend: (text: string) => void;
  onEscalate: () => void;
  /** Bloquea el textarea mientras el bot responde para evitar double-submit. */
  disabled?: boolean;
  /** Spinner en el botón "hablar con humano". */
  escalating?: boolean;
  /** Bloquea el botón si ya hay ticket creado. */
  escalateDisabled?: boolean;
}

/**
 * S4-05 + S4-08 — Footer del widget.
 *
 *  - Textarea autogrow (max 4 filas) con placeholder amistoso.
 *  - Enter envía, Shift+Enter newline. (Pattern Slack/Discord-like, esperado
 *    por usuarios de chat moderno.)
 *  - Send button deshabilitado si el draft está vacío o `disabled`.
 *  - "Hablar con humano" siempre visible debajo del textarea — no escondido
 *    en menú overflow porque la HU lo manda explícito.
 *  - A11y: aria-label en cada botón, `aria-busy` en el botón de escalar
 *    mientras `escalating`.
 */
export function ChatbotInput({
  onSend,
  onEscalate,
  disabled = false,
  escalating = false,
  escalateDisabled = false,
}: ChatbotInputProps): JSX.Element {
  const [draft, setDraft] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Autogrow simple: ajusta `height` al scrollHeight cada cambio. Cap a 96px
  // (~4 líneas) para no comerse el área de mensajes en mobile.
  React.useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
  }, [draft]);

  const handleSend = (): void => {
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const trimmedLen = draft.trim().length;
  const sendDisabled = disabled || trimmedLen === 0;

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-bg p-3">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <label htmlFor="sa-chatbot-input" className="sr-only">
          Escribe tu mensaje al asistente
        </label>
        <textarea
          id="sa-chatbot-input"
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Escribe tu pregunta…"
          disabled={disabled}
          data-testid="chatbot-input-textarea"
          className="min-h-[40px] max-h-24 flex-1 resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm leading-snug text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        />
        <button
          type="submit"
          aria-label="Enviar mensaje"
          data-testid="chatbot-input-send"
          disabled={sendDisabled}
          className="grid h-10 w-10 flex-none place-items-center rounded-md bg-accent text-accent-fg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send aria-hidden className="h-4 w-4" />
        </button>
      </form>

      <button
        type="button"
        onClick={onEscalate}
        disabled={escalating || escalateDisabled}
        aria-busy={escalating}
        aria-label="Hablar con un humano"
        data-testid="chatbot-input-escalate"
        className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {escalating ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <UserCog aria-hidden className="h-3.5 w-3.5" />
        )}
        <span>{escalating ? 'Creando ticket…' : 'Hablar con un humano'}</span>
      </button>
    </div>
  );
}
