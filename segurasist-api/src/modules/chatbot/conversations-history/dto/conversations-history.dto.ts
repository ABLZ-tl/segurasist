/**
 * Sprint 5 — S5-3 DTOs del histórico chatbot self-served.
 *
 * Endpoints insured:
 *   - GET /v1/chatbot/conversations          → ConversationListItemView[]
 *   - GET /v1/chatbot/conversations/:id/messages → ConversationMessageView[]
 *
 * Retención: 30 días. Las conversaciones con `expiresAt < NOW()` las purga
 * `ConversationsRetentionService` diariamente — el endpoint NO devuelve
 * filas expiradas (filtramos en el WHERE para defensa en profundidad).
 */
import { z } from 'zod';

export const ListConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListConversationsQuery = z.infer<typeof ListConversationsQuerySchema>;

export const ListMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;

export interface ConversationListItemView {
  id: string;
  /** Última actividad (createdAt del último ChatMessage o updatedAt). */
  lastActivityAt: string;
  /** Estado: active | escalated | closed. */
  status: 'active' | 'escalated' | 'closed';
  /** Número de mensajes (user + bot + system). */
  messageCount: number;
  /** Primeros 80 chars del último mensaje (truncado con '…'). */
  lastMessagePreview: string;
  expiresAt: string;
}

export interface ConversationMessageView {
  id: string;
  role: 'user' | 'bot' | 'system';
  content: string;
  createdAt: string;
  matched?: boolean;
}
