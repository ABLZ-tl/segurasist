/**
 * Sprint 5 — S5-3 finisher.
 *
 * Integration tests del histórico de chatbot del portal del asegurado
 * (`<HistoryClient />`).
 *
 * Mockea los hooks de `@segurasist/api-client/hooks/chatbot-history` y los
 * componentes de animación de `@segurasist/ui` (GsapStagger / PageTransition
 * pasan children sin animación en jsdom; LordIcon devuelve un placeholder
 * estable). Cubre:
 *   1. Render con 3 conversaciones mock — cards visibles con preview.
 *   2. Click en card abre drawer y carga mensajes (mock segundo hook).
 *   3. Empty state cuando data vacía.
 *   4. Loading skeleton.
 *   5. Error state visible.
 *
 * Patrón consistente con tenant-provider.spec.tsx / cross-tenant.spec.tsx
 * (mismo portal). El setup de framer-motion / next/headers ya está en
 * `vitest.setup.ts` global.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@segurasist/api-client/hooks/chatbot-history', () => ({
  useChatbotConversations: vi.fn(),
  useChatbotConversationMessages: vi.fn(),
  chatbotHistoryKeys: {
    all: ['chatbot-history'],
    list: (p: unknown) => ['chatbot-history', 'list', p],
    messages: (id: string, p: unknown) => ['chatbot-history', 'messages', id, p],
  },
}));

// Stub de animation primitives para no depender de gsap en jsdom: rendimos
// children directamente, igual que en branding-editor.spec.tsx.
vi.mock('@segurasist/ui', async () => {
  const actual = await vi.importActual<typeof import('@segurasist/ui')>(
    '@segurasist/ui',
  );
  return {
    ...actual,
    GsapStagger: ({ children, ...props }: { children: React.ReactNode }) => (
      // Render como div para no romper la grilla; data-testid se preserva
      // si el caller lo pasa via spread (`...props`).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <div {...(props as any)}>{children}</div>
    ),
    PageTransition: ({ children }: { children: React.ReactNode; routeKey?: string }) => (
      <div>{children}</div>
    ),
    LordIcon: ({ name, size = 24 }: { name?: string; size?: number }) => (
      <span
        data-testid={`lord-icon-${name ?? 'unknown'}`}
        style={{ display: 'inline-block', width: size, height: size }}
      />
    ),
  };
});

import {
  useChatbotConversations,
  useChatbotConversationMessages,
  type ConversationListItem,
  type ConversationMessage,
} from '@segurasist/api-client/hooks/chatbot-history';
import { HistoryClient } from '../../app/(app)/chatbot/history/history-client';

const mockedList = vi.mocked(useChatbotConversations);
const mockedMessages = vi.mocked(useChatbotConversationMessages);

function makeConv(idx: number, overrides: Partial<ConversationListItem> = {}): ConversationListItem {
  return {
    id: `conv-${idx}`,
    lastActivityAt: new Date(Date.now() - idx * 60_000).toISOString(),
    status: 'active',
    messageCount: 4 + idx,
    lastMessagePreview: `Última pregunta ${idx} acerca de cobertura...`,
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    ...overrides,
  };
}

function makeMsg(idx: number, overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: `msg-${idx}`,
    role: idx % 2 === 0 ? 'user' : 'bot',
    content: `Mensaje ${idx}`,
    createdAt: new Date(Date.now() - (10 - idx) * 60_000).toISOString(),
    ...overrides,
  };
}

interface ListStub {
  data: { items: ConversationListItem[]; total: number } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
}

function setup({
  items = [makeConv(1), makeConv(2, { status: 'closed' }), makeConv(3, { status: 'escalated' })],
  isLoading = false,
  isError = false,
  messagesItems = [makeMsg(0), makeMsg(1), makeMsg(2)],
  messagesLoading = false,
  messagesError = false,
}: Partial<{
  items: ConversationListItem[];
  isLoading: boolean;
  isError: boolean;
  messagesItems: ConversationMessage[];
  messagesLoading: boolean;
  messagesError: boolean;
}> = {}): void {
  const list: ListStub = {
    data: isLoading || isError ? undefined : { items, total: items.length },
    isLoading,
    isError,
    error: isError ? new Error('boom') : null,
    isFetching: false,
  };
  mockedList.mockReturnValue(list as never);

  mockedMessages.mockReturnValue({
    data: messagesLoading || messagesError
      ? undefined
      : { items: messagesItems, total: messagesItems.length },
    isLoading: messagesLoading,
    isError: messagesError,
    error: messagesError ? new Error('boom') : null,
    isFetching: false,
  } as never);
}

beforeEach(() => {
  mockedList.mockReset();
  mockedMessages.mockReset();
});

describe('<HistoryClient /> — list / states', () => {
  it('renderiza skeleton mientras isLoading=true', () => {
    setup({ isLoading: true });
    render(<HistoryClient />);
    expect(screen.getByTestId('history-skeleton')).toBeInTheDocument();
  });

  it('renderiza 3 cards mock con preview, status y count', () => {
    setup();
    render(<HistoryClient />);
    const cards = screen.getAllByTestId('conversation-card');
    expect(cards).toHaveLength(3);
    // Preview se muestra
    expect(
      within(cards[0]!).getByTestId('conversation-card-preview'),
    ).toHaveTextContent(/Última pregunta 1/i);
    // Status badge
    expect(within(cards[0]!).getByTestId('conversation-card-status')).toHaveTextContent(/Abierta/i);
    expect(within(cards[1]!).getByTestId('conversation-card-status')).toHaveTextContent(/Resuelta/i);
    expect(within(cards[2]!).getByTestId('conversation-card-status')).toHaveTextContent(/Escalada/i);
  });

  it('muestra empty state con copy y Lordicon cuando data vacía', () => {
    setup({ items: [] });
    render(<HistoryClient />);
    expect(screen.getByTestId('history-empty')).toBeInTheDocument();
    expect(
      screen.getByText(/Aún no has tenido conversaciones/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('lord-icon-chat-bubble')).toBeInTheDocument();
  });

  it('muestra error banner cuando isError=true', () => {
    setup({ isError: true });
    render(<HistoryClient />);
    expect(screen.getByTestId('history-error')).toBeInTheDocument();
    expect(
      screen.getByText(/no pudimos cargar tus conversaciones/i),
    ).toBeInTheDocument();
  });
});

describe('<HistoryClient /> — drawer interaction', () => {
  it('click en card abre drawer y muestra mensajes', async () => {
    setup({
      messagesItems: [
        makeMsg(0, { content: 'Hola, necesito ayuda', role: 'user' }),
        makeMsg(1, { content: 'Claro, ¿en qué te ayudo?', role: 'bot' }),
      ],
    });
    const user = userEvent.setup();
    render(<HistoryClient />);

    const cards = screen.getAllByTestId('conversation-card');
    await user.click(cards[0]!);

    await waitFor(() =>
      expect(screen.getByTestId('conversation-thread-drawer')).toBeInTheDocument(),
    );
    // El hook de mensajes recibió el id correcto
    expect(mockedMessages).toHaveBeenCalled();
    const lastCall = mockedMessages.mock.calls[mockedMessages.mock.calls.length - 1];
    expect(lastCall?.[0]).toBe('conv-1');
    // Mensajes renderizados via ChatbotMessageBubble
    const drawer = screen.getByTestId('conversation-thread-drawer');
    expect(within(drawer).getByText(/Hola, necesito ayuda/)).toBeInTheDocument();
    expect(within(drawer).getByText(/¿en qué te ayudo\?/)).toBeInTheDocument();
  });
});
