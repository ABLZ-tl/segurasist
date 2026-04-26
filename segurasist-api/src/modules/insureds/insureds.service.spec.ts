import { NotImplementedException } from '@nestjs/common';
import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import { InsuredsService } from './insureds.service';

describe('InsuredsService (stubs Sprint 0)', () => {
  // El servicio depende de PrismaService, pero todos los métodos lanzan NotImplementedException
  // antes de tocarlo, así que un mock vacío es suficiente.
  const prisma = mockPrismaService();
  const svc = new InsuredsService(prisma);
  const tenant = { id: '11111111-1111-1111-1111-111111111111' };

  it('list lanza NotImplementedException', async () => {
    await expect(svc.list({ limit: 50 } as never, tenant)).rejects.toThrow(NotImplementedException);
  });
  it('findOne lanza NotImplementedException', async () => {
    await expect(svc.findOne('id', tenant)).rejects.toThrow('InsuredsService.findOne');
  });
  it('create lanza NotImplementedException', async () => {
    await expect(svc.create({} as never, tenant)).rejects.toThrow('InsuredsService.create');
  });
  it('update lanza NotImplementedException', async () => {
    await expect(svc.update('id', {} as never, tenant)).rejects.toThrow('InsuredsService.update');
  });
  it('softDelete lanza NotImplementedException', async () => {
    await expect(svc.softDelete('id', tenant)).rejects.toThrow('InsuredsService.softDelete');
  });
});
