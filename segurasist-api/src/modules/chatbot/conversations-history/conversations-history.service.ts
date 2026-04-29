/**
 * Sprint 5 — S5-3 ConversationsHistoryService.
 *
 * Endpoints self-served para el portal del insured:
 *   - listConversations: lista paginada de las conversaciones del insured
 *     en los últimos 30 días (filtrado por `expiresAt > NOW()` para
 *     defensa en profundidad — el cron purga, pero entre ejecuciones
 *     puede haber filas elegibles).
 *   - listMessages: thread completo de UNA conversación. Validamos
 *     ownership: la conversación debe pertenecer al insured + tenant del
 *     JWT. RLS también lo enforza, pero el `findFirst` de pre-check
 *     devuelve 404 limpio (anti-enumeration).
 *
 * NO mutaciones aquí — read-only por diseño. Continuación de un thread
 * pasa por `POST /v1/chatbot/message` (Sprint 4 path).
 */
import { PrismaService } from '@common/prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ConversationListItemView,
  ConversationMessageView,
  ListConversationsQuery,
  ListMessagesQuery,
} from './dto/conversations-history.dto';

const PREVIEW_MAX_LEN = 80;

@Injectable()
export class ConversationsHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listConversations(args: {
    tenantId: string;
    insuredId: string;
    q: ListConversationsQuery;
  }): Promise<{ items: ConversationListItemView[]; total: number }> {
    const { tenantId, insuredId, q } = args;
    const now = new Date();

    const where = {
      tenantId,
      insuredId,
      expiresAt: { gt: now },
    } as const;

    const [conversations, total] = await Promise.all([
      this.prisma.client.chatConversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: q.limit,
        skip: q.offset,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, createdAt: true },
          },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.client.chatConversation.count({ where }),
    ]);

    const items: ConversationListItemView[] = conversations.map((c) => {
      const last = c.messages[0];
      const lastActivity = last?.createdAt ?? c.updatedAt;
      const preview = (last?.content ?? '').trim();
      const truncated =
        preview.length > PREVIEW_MAX_LEN ? `${preview.slice(0, PREVIEW_MAX_LEN - 1)}…` : preview;
      return {
        id: c.id,
        lastActivityAt: lastActivity.toISOString(),
        status: c.status as 'active' | 'escalated' | 'closed',
        messageCount: c._count.messages,
        lastMessagePreview: truncated,
        expiresAt: c.expiresAt.toISOString(),
      };
    });

    return { items, total };
  }

  async listMessages(args: {
    tenantId: string;
    insuredId: string;
    conversationId: string;
    q: ListMessagesQuery;
  }): Promise<{ items: ConversationMessageView[]; total: number }> {
    const { tenantId, insuredId, conversationId, q } = args;

    // Pre-check ownership (RLS lo aplica también; este 404 explícito previene
    // enumeration y deja el shape consistente con el rest de endpoints).
    const conv = await this.prisma.client.chatConversation.findFirst({
      where: {
        id: conversationId,
        tenantId,
        insuredId,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');

    const [rows, total] = await Promise.all([
      this.prisma.client.chatMessage.findMany({
        where: { conversationId, tenantId },
        orderBy: { createdAt: 'asc' },
        take: q.limit,
        skip: q.offset,
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
          matchedEntryId: true,
        },
      }),
      this.prisma.client.chatMessage.count({
        where: { conversationId, tenantId },
      }),
    ]);

    const items: ConversationMessageView[] = rows.map((m) => ({
      id: m.id,
      role: ((m.role ?? 'user') as 'user' | 'bot' | 'system'),
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      matched: m.matchedEntryId != null,
    }));

    return { items, total };
  }
}
