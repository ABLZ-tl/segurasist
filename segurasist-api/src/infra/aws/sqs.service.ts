import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { Inject, Injectable } from '@nestjs/common';

/**
 * SqsService — wrapper minimalista alrededor del SDK v3.
 *
 * C-09 (Sprint 4): se eliminó el parámetro `dedupeId` /
 * `MessageDeduplicationId`. Las colas reales del MVP son **standard** (NO
 * FIFO); en colas standard SQS **ignora silently** `MessageDeduplicationId`
 * (LocalStack tolera el atributo pero AWS real responde
 * `InvalidParameterValue`). Toda idempotencia movió a la capa DB con UNIQUE
 * constraints (ver `prisma/migrations/20260428_insureds_creation_unique/`,
 * y los UNIQUE existentes `(tenant_id, curp)` de `insureds`,
 * `(tenant_id, hash)` de `certificates`, etc.). ADR-016.
 *
 * Si en Sprint 5+ se introduce una cola FIFO, la API correcta es agregar
 * un método nuevo (`sendFifoMessage(queueUrl, body, dedupeId, groupId)`)
 * en lugar de reintroducir el opcional acá — eso evita que un caller pase
 * dedupeId pensando que tiene efecto en standard.
 */
@Injectable()
export class SqsService {
  private readonly client: SQSClient;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.client = new SQSClient({
      region: env.AWS_REGION,
      ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
    });
  }

  async sendMessage(
    queueUrl: string,
    body: Record<string, unknown>,
  ): Promise<string | undefined> {
    const out = await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(body),
      }),
    );
    return out.MessageId;
  }
}
