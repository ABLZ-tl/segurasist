import { NotImplementedException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService (stubs Sprint 0)', () => {
  const svc = new UsersService();
  it('list lanza NotImplementedException', () => {
    expect(() => svc.list()).toThrow(NotImplementedException);
    expect(() => svc.list()).toThrow('UsersService.list');
  });
  it('create lanza NotImplementedException', () => {
    expect(() => svc.create()).toThrow('UsersService.create');
  });
  it('update lanza NotImplementedException', () => {
    expect(() => svc.update()).toThrow('UsersService.update');
  });
  it('disable lanza NotImplementedException', () => {
    expect(() => svc.disable()).toThrow('UsersService.disable');
  });
});
