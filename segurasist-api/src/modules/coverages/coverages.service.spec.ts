import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { NotFoundException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import type { CoverageInputDto } from '../packages/dto/package.dto';
import { CoveragesService, type CoveragesScope } from './coverages.service';

describe('CoveragesService', () => {
  const tenant = { id: '11111111-1111-1111-1111-111111111111' };
  const scope: CoveragesScope = { platformAdmin: false, tenantId: tenant.id, actorId: 'u1' };

  function build(): {
    svc: CoveragesService;
    prisma: ReturnType<typeof mockPrismaService>;
    bypass: DeepMockProxy<PrismaBypassRlsService>;
  } {
    const prisma = mockPrismaService();
    const bypass = mockDeep<PrismaBypassRlsService>();
    const svc = new CoveragesService(prisma, bypass);
    return { svc, prisma, bypass };
  }

  it('list devuelve coverages con kind decodificado', async () => {
    const { svc, prisma } = build();
    prisma.client.coverage.findMany.mockResolvedValue([
      {
        id: 'c1',
        packageId: 'p1',
        name: 'Consultas',
        type: 'consultation',
        limitCount: 10,
        limitAmount: null,
        description: JSON.stringify({ kind: 'count', unit: 'consultas', description: null }),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);
    const out = await svc.list('p1', scope);
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('count');
    expect(out[0]?.unit).toBe('consultas');
  });

  it('upsertForPackage lanza NotFound si el package no existe', async () => {
    const { svc, prisma } = build();
    prisma.client.package.findFirst.mockResolvedValue(null);
    await expect(svc.upsertForPackage('missing', [], tenant)).rejects.toThrow(NotFoundException);
  });

  // M2 — superadmin cross-tenant.
  it('list con platformAdmin=true usa bypass client (sin packageId → cross-tenant)', async () => {
    const { svc, prisma, bypass } = build();
    bypass.client.coverage.findMany.mockResolvedValue([] as never);
    await svc.list(null, { platformAdmin: true, actorId: 'super-1' });
    expect(prisma.client.coverage.findMany).not.toHaveBeenCalled();
    expect(bypass.client.coverage.findMany).toHaveBeenCalledTimes(1);
    const call = bypass.client.coverage.findMany.mock.calls[0]?.[0];
    expect((call?.where as { tenantId?: unknown }).tenantId).toBeUndefined();
    expect((call?.where as { packageId?: unknown }).packageId).toBeUndefined();
  });

  it('list con platformAdmin=true + tenantId filtra por tenant', async () => {
    const { svc, bypass } = build();
    bypass.client.coverage.findMany.mockResolvedValue([] as never);
    const t = '77777777-7777-7777-7777-777777777777';
    await svc.list(null, { platformAdmin: true, tenantId: t, actorId: 'super-1' });
    const call = bypass.client.coverage.findMany.mock.calls[0]?.[0];
    expect((call?.where as { tenantId?: string }).tenantId).toBe(t);
  });

  it('upsertForPackageWithTx soft-deletea el set anterior y crea uno nuevo', async () => {
    const { svc } = build();
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const create = jest.fn().mockResolvedValue({
      id: 'new',
      packageId: 'p1',
      name: 'x',
      type: 'consultation',
      limitCount: 5,
      limitAmount: null,
      description: JSON.stringify({ kind: 'count', unit: 'u', description: null }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const tx = { coverage: { updateMany, create } } as never;
    const input: CoverageInputDto[] = [
      { name: 'x', type: 'count', limitCount: 5, unit: 'u', description: null },
    ];
    const out = await svc.upsertForPackageWithTx(tx, tenant.id, 'p1', input);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('count');
  });

  it('upsertForPackageWithTx con array vacío sólo borra el set anterior', async () => {
    const { svc } = build();
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const create = jest.fn();
    const tx = { coverage: { updateMany, create } } as never;
    const out = await svc.upsertForPackageWithTx(tx, tenant.id, 'p1', []);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(out).toHaveLength(0);
  });

  it('upsertForPackageWithTx con type=amount setea limitAmount y nullea limitCount', async () => {
    const { svc } = build();
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const create = jest.fn().mockResolvedValue({
      id: 'a1',
      packageId: 'p1',
      name: 'farmacia',
      type: 'pharmacy',
      limitCount: null,
      limitAmount: '15000.00',
      description: JSON.stringify({ kind: 'amount', unit: 'MXN', description: null }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const tx = { coverage: { updateMany, create } } as never;
    const input: CoverageInputDto[] = [
      { name: 'farmacia', type: 'amount', limitAmount: 15000, unit: 'MXN', description: null },
    ];
    const out = await svc.upsertForPackageWithTx(tx, tenant.id, 'p1', input);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'pharmacy',
          limitCount: null,
          limitAmount: 15000,
        }),
      }),
    );
    expect(out[0]?.type).toBe('amount');
    expect(out[0]?.limitAmount).toBe(15000);
  });
});
