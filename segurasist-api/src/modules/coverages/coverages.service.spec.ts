import { NotImplementedException } from '@nestjs/common';
import { CoveragesService } from './coverages.service';

describe('CoveragesService (stubs Sprint 0)', () => {
  const svc = new CoveragesService();
  it('list lanza NotImplementedException', () => {
    expect(() => svc.list()).toThrow(NotImplementedException);
    expect(() => svc.list()).toThrow('CoveragesService.list');
  });
  it('create lanza NotImplementedException', () => {
    expect(() => svc.create()).toThrow('CoveragesService.create');
  });
  it('update lanza NotImplementedException', () => {
    expect(() => svc.update()).toThrow('CoveragesService.update');
  });
  it('remove lanza NotImplementedException', () => {
    expect(() => svc.remove()).toThrow('CoveragesService.remove');
  });
});
