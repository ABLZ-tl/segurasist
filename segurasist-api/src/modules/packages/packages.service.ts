import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class PackagesService {
  list(): never {
    throw new NotImplementedException('PackagesService.list');
  }
  findOne(): never {
    throw new NotImplementedException('PackagesService.findOne');
  }
  create(): never {
    throw new NotImplementedException('PackagesService.create');
  }
  update(): never {
    throw new NotImplementedException('PackagesService.update');
  }
  remove(): never {
    throw new NotImplementedException('PackagesService.remove');
  }
}
