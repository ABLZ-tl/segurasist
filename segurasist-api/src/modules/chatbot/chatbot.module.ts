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
import { AdminChatbotKbController, ChatbotController } from './chatbot.controller';
import { EscalationService } from './escalation.service';
import { KbMatcherService } from './kb-matcher.service';
import { KbService } from './kb.service';
import { PersonalizationService } from './personalization.service';

@Module({
  controllers: [ChatbotController, AdminChatbotKbController],
  providers: [KbService, KbMatcherService, PersonalizationService, EscalationService],
  exports: [KbService, KbMatcherService, PersonalizationService, EscalationService],
})
export class ChatbotModule {}
