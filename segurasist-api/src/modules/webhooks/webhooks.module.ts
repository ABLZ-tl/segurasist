import { Module } from '@nestjs/common';
import { SesWebhookController } from './ses-webhook.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [SesWebhookController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
