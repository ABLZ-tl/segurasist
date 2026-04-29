/**
 * Sprint 5 — S5-3 hooks del histórico chatbot del portal del insured.
 *
 * Endpoints (owner BE: S5-3):
 *   - GET /v1/chatbot/conversations         → lista paginada (≤30d)
 *   - GET /v1/chatbot/conversations/:id/messages → thread completo (read-only)
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface ConversationListItem {
  id: string;
  lastActivityAt: string;
  status: 'active' | 'escalated' | 'closed';
  messageCount: number;
  lastMessagePreview: string;
  expiresAt: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'bot' | 'system';
  content: string;
  createdAt: string;
  matched?: boolean;
}

export const chatbotHistoryKeys = {
  all: ['chatbot-history'] as const,
  list: (p: { limit?: number; offset?: number }) => ['chatbot-history', 'list', p] as const,
  messages: (id: string, p: { limit?: number; offset?: number }) =>
    ['chatbot-history', 'messages', id, p] as const,
};

function qs(params: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    out.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

export const useChatbotConversations = (params: { limit?: number; offset?: number } = {}) =>
  useQuery({
    queryKey: chatbotHistoryKeys.list(params),
    queryFn: () =>
      api<{ items: ConversationListItem[]; total: number }>(
        `/v1/chatbot/conversations?${qs(params)}`,
      ),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });

export const useChatbotConversationMessages = (
  id: string,
  params: { limit?: number; offset?: number } = {},
) =>
  useQuery({
    queryKey: chatbotHistoryKeys.messages(id, params),
    queryFn: () =>
      api<{ items: ConversationMessage[]; total: number }>(
        `/v1/chatbot/conversations/${id}/messages?${qs(params)}`,
      ),
    enabled: !!id,
    staleTime: 60_000,
  });
