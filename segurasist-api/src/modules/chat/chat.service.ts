import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class ChatService {
  postMessage(): never {
    throw new NotImplementedException('ChatService.postMessage');
  }
  history(): never {
    throw new NotImplementedException('ChatService.history');
  }
  listKb(): never {
    throw new NotImplementedException('ChatService.listKb');
  }
  createKb(): never {
    throw new NotImplementedException('ChatService.createKb');
  }
  updateKb(): never {
    throw new NotImplementedException('ChatService.updateKb');
  }
}
