import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../client';
import type { ChatMessage, ChatTurn } from '../types';

export const chatKeys = {
  history: (sessionId: string) => ['chat', 'history', sessionId] as const,
};

export const useChatHistory = (sessionId: string) =>
  useQuery({
    queryKey: chatKeys.history(sessionId),
    queryFn: () => api<ChatMessage[]>(`/v1/chat/sessions/${sessionId}/messages`),
    enabled: !!sessionId,
  });

export const useChatSend = () =>
  useMutation({
    mutationFn: (params: { sessionId?: string; text: string }) =>
      api<ChatTurn>('/v1/chat/messages', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  });
