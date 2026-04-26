import { NotImplementedException } from '@nestjs/common';
import { PackagesService } from './packages.service';

describe('PackagesService (stubs Sprint 0)', () => {
  const svc = new PackagesService();
  it('list lanza NotImplementedException', () => {
    expect(() => svc.list()).toThrow(NotImplementedException);
    expect(() => svc.list()).toThrow('PackagesService.list');
  });
  it('findOne lanza NotImplementedException', () => {
    expect(() => svc.findOne()).toThrow('PackagesService.findOne');
  });
  it('create lanza NotImplementedException', () => {
    expect(() => svc.create()).toThrow('PackagesService.create');
  });
  it('update lanza NotImplementedException', () => {
    expect(() => svc.update()).toThrow('PackagesService.update');
  });
  it('remove lanza NotImplementedException', () => {
    expect(() => svc.remove()).toThrow('PackagesService.remove');
  });
});
