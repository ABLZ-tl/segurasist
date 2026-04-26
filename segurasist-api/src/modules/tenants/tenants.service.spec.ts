import { NotImplementedException } from '@nestjs/common';
import { TenantsService } from './tenants.service';

describe('TenantsService (stubs Sprint 0)', () => {
  const svc = new TenantsService();

  it('list lanza NotImplementedException', () => {
    expect(() => svc.list()).toThrow(NotImplementedException);
    expect(() => svc.list()).toThrow('TenantsService.list');
  });
  it('create lanza NotImplementedException', () => {
    expect(() => svc.create()).toThrow('TenantsService.create');
  });
  it('update lanza NotImplementedException', () => {
    expect(() => svc.update()).toThrow('TenantsService.update');
  });
  it('remove lanza NotImplementedException', () => {
    expect(() => svc.remove()).toThrow('TenantsService.remove');
  });
});
