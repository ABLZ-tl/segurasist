import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { Inject, Injectable } from '@nestjs/common';

export interface SendEmailInput {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

@Injectable()
export class SesService {
  private readonly client: SESClient;
  private readonly defaultFrom: string;
  private readonly configurationSet: string;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.client = new SESClient({
      region: env.AWS_REGION,
      ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
    });
    this.defaultFrom = `no-reply@${env.SES_SENDER_DOMAIN}`;
    this.configurationSet = env.SES_CONFIGURATION_SET;
  }

  async sendEmail(input: SendEmailInput): Promise<string | undefined> {
    const out = await this.client.send(
      new SendEmailCommand({
        Source: input.from ?? this.defaultFrom,
        Destination: { ToAddresses: input.to },
        Message: {
          Subject: { Data: input.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: input.html, Charset: 'UTF-8' },
            ...(input.text ? { Text: { Data: input.text, Charset: 'UTF-8' } } : {}),
          },
        },
        ConfigurationSetName: this.configurationSet,
      }),
    );
    return out.MessageId;
  }
}
