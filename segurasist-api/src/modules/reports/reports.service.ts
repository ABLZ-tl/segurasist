import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class ReportsService {
  conciliation(): never {
    throw new NotImplementedException('ReportsService.conciliation');
  }
  volumetry(): never {
    throw new NotImplementedException('ReportsService.volumetry');
  }
  usage(): never {
    throw new NotImplementedException('ReportsService.usage');
  }
  schedule(): never {
    throw new NotImplementedException('ReportsService.schedule');
  }
}
