import { Public } from '@common/decorators/roles.decorator';
import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

// Endpoint público; verificación se hace por firma SNS dentro del handler.
@Controller({ path: 'webhooks', version: '1' })
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Public()
  @Post('ses')
  @HttpCode(HttpStatus.NO_CONTENT)
  ses() {
    return this.webhooks.handleSes();
  }
}
