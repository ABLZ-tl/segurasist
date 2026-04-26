import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class CoveragesService {
  list(): never {
    throw new NotImplementedException('CoveragesService.list');
  }
  create(): never {
    throw new NotImplementedException('CoveragesService.create');
  }
  update(): never {
    throw new NotImplementedException('CoveragesService.update');
  }
  remove(): never {
    throw new NotImplementedException('CoveragesService.remove');
  }
}
