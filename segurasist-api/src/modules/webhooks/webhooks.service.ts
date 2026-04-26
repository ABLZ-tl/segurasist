import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class WebhooksService {
  handleSes(): never {
    throw new NotImplementedException('WebhooksService.handleSes');
  }
}
