import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class UsersService {
  list(): never {
    throw new NotImplementedException('UsersService.list');
  }
  create(): never {
    throw new NotImplementedException('UsersService.create');
  }
  update(): never {
    throw new NotImplementedException('UsersService.update');
  }
  disable(): never {
    throw new NotImplementedException('UsersService.disable');
  }
}
