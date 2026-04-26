/**
 * Poller minimalista de SQS para los workers locales.
 *
 * En producción, los handlers viven en Lambda (event-driven) y nunca pollean
 * — la cola los invoca. Pero para el dev local sin Lambda, este patrón
 * "lambda-like" levanta un cron interno que hace `ReceiveMessage` cada
 * `intervalMs` y dispara el handler por mensaje.
 *
 * Diseño:
 *  - El poller se inicia desde `onModuleInit()` del service que lo usa.
 *  - El handler debe ser idempotente (las colas SQS son at-least-once).
 *  - Si el handler falla, NO eliminamos el mensaje y SQS lo re-entrega tras
 *    el visibility timeout. Tras varios intentos cae al DLQ (configurado
 *    en LocalStack bootstrap).
 *  - El loop se detiene cuando `onModuleDestroy()` llama a `stop()`. El
 *    receive ya iniciado (long-poll) puede tardar hasta `waitTimeSeconds`
 *    en retornar — aceptable para shutdown.
 */
import type { Message, SQSClient } from '@aws-sdk/client-sqs';
import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { Logger } from '@nestjs/common';

export interface SqsPollerOptions {
  queueUrl: string;
  /** Long-poll en segundos. Recomendado: 20 (máximo SQS). */
  waitTimeSeconds?: number;
  /** Máx mensajes por receive. */
  maxMessages?: number;
  /** Visibility timeout en segundos. */
  visibilityTimeout?: number;
}

export type SqsHandler = (body: unknown, message: Message) => Promise<void>;

export class SqsPoller {
  private readonly log: Logger;
  private running = false;
  private currentLoop: Promise<void> | null = null;

  constructor(
    private readonly client: SQSClient,
    private readonly opts: SqsPollerOptions,
    private readonly handler: SqsHandler,
    loggerName: string,
  ) {
    this.log = new Logger(loggerName);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.currentLoop = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.currentLoop) {
      await this.currentLoop.catch(() => undefined);
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const out = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.opts.queueUrl,
            MaxNumberOfMessages: this.opts.maxMessages ?? 5,
            WaitTimeSeconds: this.opts.waitTimeSeconds ?? 20,
            VisibilityTimeout: this.opts.visibilityTimeout ?? 60,
          }),
        );
        const messages = out.Messages ?? [];
        for (const m of messages) {
          if (!this.running) break;
          if (!m.Body || !m.ReceiptHandle) continue;
          let body: unknown;
          try {
            body = JSON.parse(m.Body);
          } catch (err) {
            this.log.error({ err, messageId: m.MessageId }, 'mensaje SQS con body no-JSON; eliminando');
            await this.deleteMessage(m.ReceiptHandle);
            continue;
          }
          try {
            await this.handler(body, m);
            await this.deleteMessage(m.ReceiptHandle);
          } catch (err) {
            this.log.error(
              { err, messageId: m.MessageId },
              'handler SQS falló; mensaje vuelve a la cola tras visibility timeout',
            );
          }
        }
      } catch (err) {
        // En LocalStack el primer poll falla si la cola no existe — esperamos
        // un poco antes de re-intentar para no spamear el log.
        this.log.warn({ err }, 'ReceiveMessage falló; esperando 5s antes de reintentar');
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteMessageCommand({
          QueueUrl: this.opts.queueUrl,
          ReceiptHandle: receiptHandle,
        }),
      );
    } catch (err) {
      this.log.warn({ err }, 'DeleteMessage falló; el mensaje puede re-entregarse');
    }
  }
}
