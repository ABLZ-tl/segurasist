import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class ClaimsService {
  list(): never {
    throw new NotImplementedException('ClaimsService.list');
  }
  create(): never {
    throw new NotImplementedException('ClaimsService.create');
  }
  update(): never {
    throw new NotImplementedException('ClaimsService.update');
  }
}
