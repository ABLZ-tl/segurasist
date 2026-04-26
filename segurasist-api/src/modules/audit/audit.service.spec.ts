import { NotImplementedException } from '@nestjs/common';
import { AuditService } from './audit.service';

describe('AuditService (stub Sprint 0)', () => {
  it('list lanza NotImplementedException', () => {
    const svc = new AuditService();
    expect(() => svc.list()).toThrow(NotImplementedException);
    expect(() => svc.list()).toThrow('AuditService.list');
  });
});
