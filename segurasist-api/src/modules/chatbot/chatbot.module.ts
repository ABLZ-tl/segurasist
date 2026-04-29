/**
 * Chatbot module — Sprint 4 coordinación S5 (KB + matching + admin CRUD) y
 * S6 (Personalization + Escalation).
 *
 * S5 expone (S4-06):
 *   - KbService — message flow + admin CRUD entries.
 *   - KbMatcherService — algoritmo de matching keywords + sinónimos.
 *
 * S6 expone:
 *   - PersonalizationService — fillPlaceholders(template, insuredId).
 *   - EscalationService — escalate(insuredId, conversationId, reason).
 *
 * Dependencias externas:
 *   - PrismaService / PrismaModule (Global ya importado en AppModule).
 *   - SesService (vía AwsModule).
 *   - AuditWriterService + AuditContextFactory (ambos exportados @Global por
 *     AuditPersistenceModule).
 *
 * No re-importamos los Global modules; sólo declaramos los providers locales
 * y los exportamos para que el ChatbotController los inyecte.
 */
import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ConversationsHistoryController } from './conversations-history/conversations-history.controller';
import { ConversationsHistoryService } from './conversations-history/conversations-history.service';
import { ConversationsRetentionService } from './cron/conversations-retention.service';
import { EscalationService } from './escalation.service';
import { KbAdminController } from './kb-admin/kb-admin.controller';
import { KbAdminService } from './kb-admin/kb-admin.service';
import { KbMatcherService } from './kb-matcher.service';
import { KbService } from './kb.service';
import { PersonalizationService } from './personalization.service';

/**
 * Sprint 5 — S5-3 amplía el módulo con:
 *   - `KbAdminController` / `KbAdminService` (editor admin con vocabulario
 *     `intent`/`title`/`body`, test-match, CSV import). Reemplaza el
 *     `AdminChatbotKbController` legacy de Sprint 4 bajo el mismo path
 *     `/v1/admin/chatbot/kb` — el nuevo controller soporta tanto `PUT /:id`
 *     (canónico Sprint 5) como `PATCH /:id` (compat Sprint 4 cross-tenant
 *     test) para no romper integration tests existentes.
 *   - `ConversationsHistoryController` / `ConversationsHistoryService`
 *     (insureds consultan su histórico self-served, paginado).
 *   - `ConversationsRetentionService` (cron diario que purga
 *     `chat_conversations` con `expiresAt < NOW()` — cascada vía
 *     ChatMessage soft-FK).
 */
@Module({
  controllers: [ChatbotController, KbAdminController, ConversationsHistoryController],
  providers: [
    KbService,
    KbMatcherService,
    PersonalizationService,
    EscalationService,
    KbAdminService,
    ConversationsHistoryService,
    ConversationsRetentionService,
  ],
  exports: [
    KbService,
    KbMatcherService,
    PersonalizationService,
    EscalationService,
    KbAdminService,
    ConversationsHistoryService,
    ConversationsRetentionService,
  ],
})
export class ChatbotModule {}
