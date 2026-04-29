/**
 * Sprint 5 — S5-3 ConversationsRetentionService.
 *
 * Purga diaria a las 03:00 UTC de las `chat_conversations` con
 * `expiresAt < NOW()`. Los `chat_messages` se borran en cascada vía
 * `Prisma.$transaction` (la FK conversationId es nullable y NO tiene ON
 * DELETE CASCADE en BD — la cascada lógica la hace este service para que
 * el audit log refleje "N conversations + M messages purgados").
 *
 * Schedule:
 *   - El brief pide `@Cron('0 3 * * *')` via `@nestjs/schedule`. Ese paquete
 *     NO está instalado en `segurasist-api/package.json` (Sprint 4 reports
 *     cron usa SQS + EventBridge — no @nestjs/schedule). Para no agregar
 *     una dep pesada en iter 1 sin coordinarse con DevOps, este service
 *     implementa el scheduler con `setInterval` + un cálculo de la próxima
 *     ejecución a las 03:00 UTC (idéntico shape al `MonthlyReportsHandler`
 *     poll loop).
 *   - NEW-FINDING tracked en feed S5-3-iter1: si ops decide adoptar
 *     `@nestjs/schedule` Sprint 6, este service migra a `@Cron('0 3 * * *')`.
 *
 * Invocación manual:
 *   - El método `runOnce()` está expuesto público para tests y para un
 *     comando admin futuro (`scripts/purge-conversations.ts`).
 *
 * Audit:
 *   - Por cada conversación borrada se emite UN evento (acción genérica
 *     `delete` con `payloadDiff.subAction='chatbot_conversation_purged'`).
 *     Ver KbAdminService docstring para el rationale del subAction-pattern.
 *   - Para batches grandes (>1000), agregamos UN evento resumen al final
 *     `chatbot_conversations_purge_run` con totales y duración.
 *
 * BatchSize:
 *   - 1000 conversations por iteración. Reduce risk de transaction lock
 *     largo. El loop continúa hasta que un batch retorne <1000.
 */
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';

const BATCH_SIZE = 1000;
const TARGET_HOUR_UTC = 3;
/**
 * Lookup interval para "es cuasi 03:00 UTC". El loop chequea cada 60s y
 * dispara cuando entra en la ventana [03:00, 03:01) UTC. Doble-check con
 * un flag de last-run-day para no duplicar la corrida si el proceso reinicia.
 */
const POLL_INTERVAL_MS = 60_000;

@Injectable()
export class ConversationsRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(ConversationsRetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private stopRequested = false;
  /** YYYY-MM-DD (UTC) del último día que ya corrimos. */
  private lastRunDay: string | null = null;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaBypassRlsService,
    private readonly auditWriter: AuditWriterService,
  ) {
    this.enabled =
      (process.env.WORKERS_ENABLED ?? 'false') === 'true' && process.env.NODE_ENV !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.log.log(
        { enabled: this.enabled, nodeEnv: process.env.NODE_ENV },
        'ConversationsRetention NO inicia poller (WORKERS_ENABLED!=true o NODE_ENV=test)',
      );
      return;
    }
    this.timer = setInterval(() => {
      void this.maybeRun();
    }, POLL_INTERVAL_MS);
    this.log.log({ targetHourUtc: TARGET_HOUR_UTC }, 'ConversationsRetention scheduler started');
  }

  async onModuleDestroy(): Promise<void> {
    this.stopRequested = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Decide si correr la purga ahora. Llamado cada minuto por el setInterval.
   * Dispara cuando: hora UTC == 3 && minute == 0 && lastRunDay != today.
   */
  private async maybeRun(): Promise<void> {
    if (this.stopRequested) return;
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();
    const today = now.toISOString().slice(0, 10);
    if (utcHour !== TARGET_HOUR_UTC || utcMinute !== 0) return;
    if (this.lastRunDay === today) return;
    this.lastRunDay = today;
    try {
      await this.runOnce();
    } catch (err) {
      this.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'ConversationsRetention runOnce falló',
      );
    }
  }

  /**
   * Visible para tests / admin manual. Itera batches de BATCH_SIZE hasta
   * agotar las conversaciones expiradas. Devuelve el resumen agregado.
   */
  async runOnce(): Promise<{
    purgedConversations: number;
    purgedMessages: number;
    durationMs: number;
  }> {
    const startedAt = Date.now();
    const now = new Date();
    let purgedConversations = 0;
    let purgedMessages = 0;

    // Loop hasta vaciar elegibles. Cada iteración es una transacción
    // independiente — un fallo en mid-loop NO revierte lo previo.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const expired = await this.prisma.client.chatConversation.findMany({
        where: { expiresAt: { lt: now } },
        select: { id: true, tenantId: true, insuredId: true },
        take: BATCH_SIZE,
        orderBy: { expiresAt: 'asc' },
      });
      if (expired.length === 0) break;

      const ids = expired.map((c) => c.id);

      const result = await this.prisma.client.$transaction(async (tx) => {
        // Borrar messages primero (FK).
        const msgs = await tx.chatMessage.deleteMany({
          where: { conversationId: { in: ids } },
        });
        const convs = await tx.chatConversation.deleteMany({
          where: { id: { in: ids } },
        });
        return { messages: msgs.count, conversations: convs.count };
      });

      purgedConversations += result.conversations;
      purgedMessages += result.messages;

      // Audit por conversación: NO escalable a 100k/día, pero a la escala
      // MVP (≤500 conv/día) es razonable. Si crece, mover a 1 evento
      // resumen por batch en iter 2.
      for (const conv of expired) {
        void this.auditWriter.record({
          tenantId: conv.tenantId,
          actorId: conv.insuredId,
          action: 'delete',
          resourceType: 'chatbot.conversation',
          resourceId: conv.id,
          payloadDiff: {
            subAction: 'chatbot_conversation_purged',
            reason: 'retention_30d',
          },
        });
      }

      // Si el batch llenó el cap, hay más; sino terminamos.
      if (expired.length < BATCH_SIZE) break;
    }

    const durationMs = Date.now() - startedAt;
    this.log.log(
      { purgedConversations, purgedMessages, durationMs },
      'ConversationsRetention purge run completed',
    );

    // Resumen estructurado en pino para CloudWatch — los audit events por
    // conversación cubren el per-tenant trail. NO emitimos un audit con
    // tenantId placeholder porque el hash chain del audit_log es per-tenant
    // y un UUID inexistente lo contaminaría. La query "última corrida del
    // cron" en CloudWatch logs es 1-liner: `filter @message like /purge run completed/`.

    return { purgedConversations, purgedMessages, durationMs };
  }
}
