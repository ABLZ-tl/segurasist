import { NotImplementedException } from '@nestjs/common';
import { CertificatesService } from './certificates.service';

describe('CertificatesService (stubs Sprint 0)', () => {
  const svc = new CertificatesService();
  it('list lanza NotImplementedException', () => {
    expect(() => svc.list()).toThrow(NotImplementedException);
    expect(() => svc.list()).toThrow('CertificatesService.list');
  });
  it('findOne lanza NotImplementedException', () => {
    expect(() => svc.findOne()).toThrow('CertificatesService.findOne');
  });
  it('presignedUrl lanza NotImplementedException', () => {
    expect(() => svc.presignedUrl()).toThrow('CertificatesService.presignedUrl');
  });
  it('reissue lanza NotImplementedException', () => {
    expect(() => svc.reissue()).toThrow('CertificatesService.reissue');
  });
});
