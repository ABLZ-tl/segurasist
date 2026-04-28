'use client';

/**
 * S4-05 — Estado local del widget chatbot.
 *
 * Diseño:
 *  - Zustand store con persistencia manual a `localStorage` (sin `persist`
 *    middleware) porque solo guardamos un subset (mensajes + conversationId,
 *    NO `open` ni `pendingMessage`) y queremos control fino sobre la versión
 *    del schema para invalidar cache vieja.
 *  - SSR-safe: `loadFromStorage()` solo corre client-side; en server-side
 *    el store arranca vacío y se hidrata cuando el componente monta.
 *  - TTL: 7 días. Una conversación más vieja que eso se descarta al cargar.
 *    Mantener histórico larguísimo añade riesgo PII en el browser y poco
 *    valor (el asegurado ya recibió respuesta).
 *
 * Por qué zustand y no React Context:
 *   - Mensajes se actualizan ~1/seg mientras el bot escribe; Context dispara
 *     re-render del subtree completo, zustand solo del componente suscrito.
 *   - El widget vive en el layout raíz; queremos que cualquier página pueda
 *     llamar `useChatbotStore.getState().openWith('texto inicial')` (p.e.
 *     un CTA "Pregunta al asistente") sin re-arquitecturar el contexto.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'sa.portal.chatbot.v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

export interface ChatbotMessage {
  id: string;
  author: 'user' | 'bot' | 'system';
  text: string;
  /** ISO timestamp para mostrar relativo (ej. "hace 2 min"). */
  ts: string;
}

interface PersistedShape {
  conversationId: string | null;
  messages: ChatbotMessage[];
  savedAt: string;
}

export interface ChatbotState {
  open: boolean;
  conversationId: string | null;
  messages: ChatbotMessage[];
  /** True mientras el bot está pensando — pinta el typing indicator. */
  pending: boolean;
  /** True después de un escalate exitoso. Render del banner "ticket creado". */
  escalatedTicketId: string | null;
  setOpen: (open: boolean) => void;
  appendMessage: (msg: ChatbotMessage) => void;
  setConversationId: (id: string) => void;
  setPending: (pending: boolean) => void;
  markEscalated: (ticketId: string) => void;
  clearEscalation: () => void;
  reset: () => void;
  /** Llamar UNA VEZ desde el componente raíz al montar. */
  hydrateFromStorage: () => void;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readPersisted(): PersistedShape | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShape;
    if (!parsed?.savedAt) return null;
    const age = Date.now() - new Date(parsed.savedAt).getTime();
    if (Number.isNaN(age) || age > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersisted(state: ChatbotState): void {
  if (!isBrowser()) return;
  try {
    const payload: PersistedShape = {
      conversationId: state.conversationId,
      messages: state.messages.slice(-50), // capa anti-bloat
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // QuotaExceeded / privacy mode — ignoramos silently. El widget sigue
    // funcionando in-memory.
  }
}

export const useChatbotStore = create<ChatbotState>((set, get) => ({
  open: false,
  conversationId: null,
  messages: [],
  pending: false,
  escalatedTicketId: null,
  setOpen: (open) => {
    set({ open });
    // Limpiar el banner de escalación cuando el usuario cierra el panel.
    if (!open) set({ escalatedTicketId: null });
  },
  appendMessage: (msg) => {
    set((s) => ({ messages: [...s.messages, msg] }));
    writePersisted(get());
  },
  setConversationId: (id) => {
    set({ conversationId: id });
    writePersisted(get());
  },
  setPending: (pending) => set({ pending }),
  markEscalated: (ticketId) => set({ escalatedTicketId: ticketId }),
  clearEscalation: () => set({ escalatedTicketId: null }),
  reset: () => {
    set({
      conversationId: null,
      messages: [],
      pending: false,
      escalatedTicketId: null,
    });
    if (isBrowser()) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* noop */
      }
    }
  },
  hydrateFromStorage: () => {
    const persisted = readPersisted();
    if (!persisted) return;
    set({
      conversationId: persisted.conversationId,
      messages: persisted.messages,
    });
  },
}));

/** Test-only: limpia el store entre specs. */
export function __resetChatbotStoreForTests(): void {
  useChatbotStore.setState({
    open: false,
    conversationId: null,
    messages: [],
    pending: false,
    escalatedTicketId: null,
  });
  if (isBrowser()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  }
}
