/**
 * Sprint 5 — S5-3 ConversationsHistoryController.
 *
 * Endpoints insured-only:
 *   - GET /v1/chatbot/conversations          (paginated, only mine)
 *   - GET /v1/chatbot/conversations/:id/messages
 *
 * Throttle: 60/min — el portal no abre el histórico cada segundo y el
 * `staleTime` del react-query lo deja en cache 60s. Los reads no son
 * sensibles a abuso pero respetar el global default es defensa.
 */
import { CurrentUser, type AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { Tenant, type TenantCtx } from '@common/decorators/tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Throttle } from '@common/throttler/throttler.decorators';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConversationsHistoryService } from './conversations-history.service';
import {
  ListConversationsQuerySchema,
  ListMessagesQuerySchema,
  type ConversationListItemView,
  type ConversationMessageView,
  type ListConversationsQuery,
  type ListMessagesQuery,
} from './dto/conversations-history.dto';

@ApiTags('chatbot-conversations')
@Controller({ path: 'chatbot/conversations', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConversationsHistoryController {
  constructor(private readonly svc: ConversationsHistoryService) {}

  @Get()
  @Roles('insured')
  @Throttle({ ttl: 60_000, limit: 60 })
  @ApiOperation({ summary: 'Lista mis conversaciones del chatbot (≤30 días).' })
  async list(
    @Query(new ZodValidationPipe(ListConversationsQuerySchema)) q: ListConversationsQuery,
    @Tenant() tenant: TenantCtx,
    @CurrentUser() user: AuthUser,
  ): Promise<{ items: ConversationListItemView[]; total: number }> {
    return this.svc.listConversations({ tenantId: tenant.id, insuredId: user.id, q });
  }

  @Get(':id/messages')
  @Roles('insured')
  @Throttle({ ttl: 60_000, limit: 60 })
  @ApiOperation({ summary: 'Mensajes de una conversación (read-only).' })
  async messages(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(ListMessagesQuerySchema)) q: ListMessagesQuery,
    @Tenant() tenant: TenantCtx,
    @CurrentUser() user: AuthUser,
  ): Promise<{ items: ConversationMessageView[]; total: number }> {
    return this.svc.listMessages({
      tenantId: tenant.id,
      insuredId: user.id,
      conversationId: id,
      q,
    });
  }
}
