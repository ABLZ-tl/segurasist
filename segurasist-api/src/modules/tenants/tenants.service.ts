import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class TenantsService {
  list(): never {
    throw new NotImplementedException('TenantsService.list');
  }
  create(): never {
    throw new NotImplementedException('TenantsService.create');
  }
  update(): never {
    throw new NotImplementedException('TenantsService.update');
  }
  remove(): never {
    throw new NotImplementedException('TenantsService.remove');
  }
}
