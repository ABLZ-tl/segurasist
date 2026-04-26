import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { Inject, Injectable } from '@nestjs/common';

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
    dedupeId?: string,
  ): Promise<string | undefined> {
    const out = await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(body),
        ...(dedupeId ? { MessageDeduplicationId: dedupeId } : {}),
      }),
    );
    return out.MessageId;
  }
}
