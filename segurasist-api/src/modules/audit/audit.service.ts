import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class AuditService {
  list(): never {
    throw new NotImplementedException('AuditService.list');
  }
}
