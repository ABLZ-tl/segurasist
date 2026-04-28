/**
 * S4-05 / S4-08 — Integration spec del widget chatbot del portal.
 *
 * Cubre el flujo end-to-end client-side (sin levantar Next):
 *  1. Render inicial → FAB cerrado, panel oculto.
 *  2. Click FAB → panel `role="dialog"` montado, mensaje de bienvenida visible.
 *  3. Escribir mensaje + click Send → mutation invocada con body correcto;
 *     mensaje del usuario aparece en lista; respuesta del bot aparece;
 *     conversationId se persiste.
 *  4. Click "hablar con humano" sin conversación → toast "envía primero un
 *     mensaje", NO se invoca escalate.
 *  5. Tras al menos un turno con conversationId → click "hablar con humano"
 *     → escalate mutation invocada; banner "ticket creado" aparece;
 *     botón queda deshabilitado para evitar duplicados.
 *  6. localStorage persiste mensajes (smoke check).
 *
 * Estrategia de mocks:
 *  - Mockeamos `fetch` global (mismo helper que `insured-flow.spec.ts`),
 *    devolviendo respuestas canónicas por path. NO mockeamos el hook
 *    completo: queremos que `useSendChatMessage` real corra para validar
 *    que el path/verbo son correctos.
 *  - El componente `ChatbotWidget` se monta dentro de `QueryClientProvider`
 *    minimal para los hooks; no necesitamos providers adicionales (el
 *    Toaster real no rendereamos, los toasts son fire-and-forget).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';
import {
  render,
  screen,
  waitFor,
  act,
  within,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatbotWidget } from '../../components/chatbot/chatbot-widget';
import { __resetChatbotStoreForTests } from '../../components/chatbot/chatbot-store';

// El Toaster usa Sonner. En jsdom Sonner intenta crear un portal —
// stub simple para que `toast.error` / `toast.success` no exploten.
vi.mock('@segurasist/ui', async () => {
  const actual =
    await vi.importActual<typeof import('@segurasist/ui')>('@segurasist/ui');
  return {
    ...actual,
    toast: {
      message: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

// ---------- fetch mock helpers (alineados con insured-flow.spec.ts) ----------
interface FetchCall {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

const fetchCalls: FetchCall[] = [];
const ORIGINAL_FETCH = globalThis.fetch;

type FetchHandler = (call: FetchCall) => Response | Promise<Response>;

function setupFetchMock(handler: FetchHandler): void {
  fetchCalls.length = 0;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const headers = (init?.headers as Record<string, string> | undefined) ?? {};
    const call: FetchCall = { url, method, body, headers };
    fetchCalls.push(call);
    return handler(call);
  }) as typeof fetch;
}

function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeWrapper(): {
  Wrapper: React.FC<{ children: React.ReactNode }>;
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { Wrapper, client };
}

beforeEach(() => {
  __resetChatbotStoreForTests();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  __resetChatbotStoreForTests();
});

describe('ChatbotWidget — S4-05 / S4-08', () => {
  it('render inicial: FAB visible, panel cerrado, sin llamadas a fetch', () => {
    setupFetchMock(() => jsonResponse({}));
    const { Wrapper } = makeWrapper();
    render(React.createElement(ChatbotWidget), { wrapper: Wrapper });

    expect(screen.getByTestId('chatbot-fab')).toBeInTheDocument();
    expect(screen.queryByTestId('chatbot-panel')).not.toBeInTheDocument();
    expect(fetchCalls).toHaveLength(0);
  });

  it('click FAB abre el panel con dialog role + mensaje de bienvenida', async () => {
    setupFetchMock(() => jsonResponse({}));
    const { Wrapper } = makeWrapper();
    render(React.createElement(ChatbotWidget), { wrapper: Wrapper });

    await userEvent.click(screen.getByTestId('chatbot-fab'));

    const panel = screen.getByTestId('chatbot-panel');
    expect(panel).toHaveAttribute('role', 'dialog');
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(within(panel).getByText(/Asistente SegurAsist/i)).toBeInTheDocument();
    // welcome bubble
    expect(within(panel).getByText(/Pregúntame sobre tu póliza/i)).toBeInTheDocument();
  });

  it('escribir mensaje + click Send → POST /v1/chatbot/message + bot reply visible', async () => {
    const reply = {
      conversationId: 'conv-abc',
      messageId: 'm-bot-1',
      reply: 'Tu póliza vence el 2027-01-01.',
      author: 'bot' as const,
      ts: '2026-04-27T10:00:00.000Z',
    };
    setupFetchMock(() => jsonResponse(reply));
    const { Wrapper } = makeWrapper();
    render(React.createElement(ChatbotWidget), { wrapper: Wrapper });

    await userEvent.click(screen.getByTestId('chatbot-fab'));
    const textarea = screen.getByTestId('chatbot-input-textarea');
    await userEvent.type(textarea, '¿Hasta cuándo es mi póliza?');
    await userEvent.click(screen.getByTestId('chatbot-input-send'));

    // Mensaje del usuario aparece inmediatamente.
    await waitFor(() =>
      expect(
        screen.getByText('¿Hasta cuándo es mi póliza?'),
      ).toBeInTheDocument(),
    );

    // fetch invocado con body correcto.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    expect(fetchCalls[0]!.method).toBe('POST');
    expect(fetchCalls[0]!.url).toBe('/api/proxy/v1/chatbot/message');
    expect(JSON.parse(fetchCalls[0]!.body ?? '{}')).toEqual({
      message: '¿Hasta cuándo es mi póliza?',
    });

    // Respuesta del bot aparece.
    await waitFor(() =>
      expect(
        screen.getByText('Tu póliza vence el 2027-01-01.'),
      ).toBeInTheDocument(),
    );
  });

  it('Enter en el textarea envía; Shift+Enter inserta newline', async () => {
    setupFetchMock(() =>
      jsonResponse({
        conversationId: 'c1',
        messageId: 'm1',
        reply: 'ok',
        author: 'bot',
        ts: '2026-04-27T10:00:00.000Z',
      }),
    );
    const { Wrapper } = makeWrapper();
    render(React.createElement(ChatbotWidget), { wrapper: Wrapper });

    await userEvent.click(screen.getByTestId('chatbot-fab'));
    const textarea = screen.getByTestId('chatbot-input-textarea') as HTMLTextAreaElement;

    // Shift+Enter NO envía
    await userEvent.type(textarea, 'línea1');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(fetchCalls).toHaveLength(0);

    // Enter solo SÍ envía
    await userEvent.type(textarea, 'final');
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(fetchCalls.length).toBeGreaterThanOrEqual(1));
    expect(fetchCalls[0]!.url).toBe('/api/proxy/v1/chatbot/message');
  });

  it('click "hablar con humano" SIN conversación → no llama backend', async () => {
    setupFetchMock(() => jsonResponse({}));
    const { Wrapper } = makeWrapper();
    render(React.createElement(ChatbotWidget), { wrapper: Wrapper });

    await userEvent.click(screen.getByTestId('chatbot-fab'));
    await userEvent.click(screen.getByTestId('chatbot-input-escalate'));

    // No debería haber llamado a /escalate.
    expect(fetchCalls.filter((c) => c.url.includes('escalate'))).toHaveLength(0);
  });

  it('escalate después de un mensaje → POST /v1/chatbot/escalate + banner ticket', async () => {
    const messageReply = {
      conversationId: 'conv-xyz',
      messageId: 'm-1',
      reply: 'Hola',
      author: 'bot' as const,
      ts: '2026-04-27T10:00:00.000Z',
    };
    const escalateReply = {
      ticketId: 'TK-2026-0042',
      status: 'created' as const,
      ackEmailQueued: true,
    };
    setupFetchMock((call) => {
      if (call.url.endsWith('/v1/chatbot/message')) return jsonResponse(messageReply);
      if (call.url.endsWith('/v1/chatbot/escalate')) return jsonResponse(escalateReply);
      return new Response('not-found', { status: 404 });
    });

    const { Wrapper } = makeWrapper();
    render(React.createElement(ChatbotWidget), { wrapper: Wrapper });

    await userEvent.click(screen.getByTestId('chatbot-fab'));
    const textarea = screen.getByTestId('chatbot-input-textarea');
    await userEvent.type(textarea, 'hola');
    await userEvent.click(screen.getByTestId('chatbot-input-send'));

    await waitFor(() => expect(screen.getByText('Hola')).toBeInTheDocument());

    // Click escalate
    await userEvent.click(screen.getByTestId('chatbot-input-escalate'));

    await waitFor(() => {
      const escalateCall = fetchCalls.find((c) => c.url.endsWith('/v1/chatbot/escalate'));
      expect(escalateCall).toBeDefined();
      expect(escalateCall!.method).toBe('POST');
      expect(JSON.parse(escalateCall!.body ?? '{}')).toEqual({
        conversationId: 'conv-xyz',
      });
    });

    // Banner ticket creado.
    await waitFor(() => {
      const banner = screen.getByTestId('chatbot-escalated-banner');
      expect(banner).toHaveTextContent('TK-2026-0042');
    });

    // El botón escalate queda deshabilitado para evitar tickets duplicados.
    expect(screen.getByTestId('chatbot-input-escalate')).toBeDisabled();
  });

  it('error en send → mensaje de sistema visible + no rompe la UI', async () => {
    setupFetchMock(
      () =>
        new Response(
          JSON.stringify({
            type: 'about:blank',
            title: 'KB unavailable',
            status: 503,
            detail: 'kb-down',
            traceId: 'tr-1',
          }),
          {
            status: 503,
            headers: { 'content-type': 'application/problem+json' },
          },
        ),
    );

    const { Wrapper } = makeWrapper();
    render(React.createElement(ChatbotWidget), { wrapper: Wrapper });

    await userEvent.click(screen.getByTestId('chatbot-fab'));
    const textarea = screen.getByTestId('chatbot-input-textarea');
    await userEvent.type(textarea, 'hola');
    await userEvent.click(screen.getByTestId('chatbot-input-send'));

    // System bubble aparece después del fallo.
    await waitFor(() =>
      expect(screen.getByTestId('chatbot-message-system')).toBeInTheDocument(),
    );
    // El user bubble sigue visible (no lo borramos).
    expect(screen.getByText('hola')).toBeInTheDocument();
  });

  it('persistencia localStorage: tras un turno, el storage tiene el conversationId', async () => {
    const reply = {
      conversationId: 'conv-persist',
      messageId: 'm-1',
      reply: 'r',
      author: 'bot' as const,
      ts: '2026-04-27T10:00:00.000Z',
    };
    setupFetchMock(() => jsonResponse(reply));
    const { Wrapper } = makeWrapper();
    render(React.createElement(ChatbotWidget), { wrapper: Wrapper });

    await userEvent.click(screen.getByTestId('chatbot-fab'));
    const textarea = screen.getByTestId('chatbot-input-textarea');
    await userEvent.type(textarea, 'hola');
    await userEvent.click(screen.getByTestId('chatbot-input-send'));

    await waitFor(() => expect(screen.getByText('r')).toBeInTheDocument());

    const raw = window.localStorage.getItem('sa.portal.chatbot.v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { conversationId: string; messages: unknown[] };
    expect(parsed.conversationId).toBe('conv-persist');
    expect(parsed.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('Esc cierra el panel', async () => {
    setupFetchMock(() => jsonResponse({}));
    const { Wrapper } = makeWrapper();
    render(React.createElement(ChatbotWidget), { wrapper: Wrapper });

    await userEvent.click(screen.getByTestId('chatbot-fab'));
    expect(screen.getByTestId('chatbot-panel')).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    await waitFor(() =>
      expect(screen.queryByTestId('chatbot-panel')).not.toBeInTheDocument(),
    );
  });

  it('A11y: panel tiene aria-modal y aria-labelledby al título', async () => {
    setupFetchMock(() => jsonResponse({}));
    const { Wrapper } = makeWrapper();
    render(React.createElement(ChatbotWidget), { wrapper: Wrapper });

    await userEvent.click(screen.getByTestId('chatbot-fab'));
    const panel = screen.getByTestId('chatbot-panel');
    expect(panel).toHaveAttribute('aria-modal', 'true');
    const labelledBy = panel.getAttribute('aria-labelledby');
    expect(labelledBy).toBe('sa-chatbot-title');
    expect(document.getElementById(labelledBy!)).toBeInTheDocument();

    // Lista de mensajes con aria-live polite.
    const messagesList = screen.getByTestId('chatbot-messages');
    expect(messagesList).toHaveAttribute('aria-live', 'polite');
  });

  it('enabled=false → no renderiza nada', () => {
    setupFetchMock(() => jsonResponse({}));
    const { Wrapper } = makeWrapper();
    const { container } = render(
      React.createElement(ChatbotWidget, { enabled: false }),
      { wrapper: Wrapper },
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('chatbot-fab')).not.toBeInTheDocument();
  });
});
