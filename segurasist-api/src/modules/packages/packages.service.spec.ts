import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import type { CoveragesService } from '../coverages/coverages.service';
import { PackagesService } from './packages.service';

describe('PackagesService', () => {
  const tenant = { id: '11111111-1111-1111-1111-111111111111' };

  function build(): {
    svc: PackagesService;
    prisma: ReturnType<typeof mockPrismaService>;
    coverages: jest.Mocked<CoveragesService>;
  } {
    const prisma = mockPrismaService();
    const coverages = {
      list: jest.fn(),
      upsertForPackage: jest.fn(),
      upsertForPackageWithTx: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<CoveragesService>;
    const svc = new PackagesService(prisma, coverages);
    return { svc, prisma, coverages };
  }

  it('list devuelve cursor-paginated y mapea counts', async () => {
    const { svc, prisma } = build();
    prisma.client.package.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Básico',
        description: null,
        status: 'active',
        createdAt: new Date('2026-04-20'),
        updatedAt: new Date('2026-04-20'),
        coverages: [{ id: 'c1' }],
        _count: { insureds: 5 },
      },
    ] as never);
    const out = await svc.list({ limit: 50 }, tenant);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      id: 'p1',
      name: 'Básico',
      coveragesCount: 1,
      insuredsActive: 5,
    });
    expect(out.nextCursor).toBeNull();
  });

  it('list con más resultados que el limit devuelve nextCursor', async () => {
    const { svc, prisma } = build();
    prisma.client.package.findMany.mockResolvedValue(
      Array.from({ length: 3 }).map((_, i) => ({
        id: `p${i}`,
        name: `Pkg${i}`,
        description: null,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        coverages: [],
        _count: { insureds: 0 },
      })) as never,
    );
    const out = await svc.list({ limit: 2 }, tenant);
    expect(out.items).toHaveLength(2);
    expect(out.nextCursor).toBe('p1');
  });

  it('findOne lanza NotFound si el package no existe', async () => {
    const { svc, prisma } = build();
    prisma.client.package.findFirst.mockResolvedValue(null);
    await expect(svc.findOne('missing', tenant)).rejects.toThrow(NotFoundException);
  });

  it('findOne devuelve detalle con coverages decodificadas', async () => {
    const { svc, prisma } = build();
    prisma.client.package.findFirst.mockResolvedValue({
      id: 'p1',
      name: 'Premium',
      description: 'desc',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      coverages: [
        {
          id: 'c1',
          name: 'Consultas',
          type: 'consultation',
          limitCount: 10,
          limitAmount: null,
          description: JSON.stringify({ kind: 'count', unit: 'consultas', description: 'X' }),
        },
      ],
      _count: { insureds: 3 },
    } as never);
    const out = await svc.findOne('p1', tenant);
    expect(out.coverages).toHaveLength(1);
    expect(out.coverages[0]).toMatchObject({
      type: 'count',
      limitCount: 10,
      unit: 'consultas',
      description: 'X',
    });
  });

  it('create lanza Conflict si Prisma reporta P2002', async () => {
    const { svc, prisma } = build();
    prisma.withTenant.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5.0',
      });
    });
    await expect(svc.create({ name: 'dup', coverages: [], status: 'active' }, tenant)).rejects.toThrow(
      ConflictException,
    );
  });

  it('create exitosamente delega upsert de coverages e invoca findOne', async () => {
    const { svc, prisma, coverages } = build();
    prisma.withTenant.mockImplementation(async (fn) => {
      const tx = {
        package: {
          create: jest.fn().mockResolvedValue({
            id: 'new',
            name: 'X',
            status: 'active',
          }),
        },
      };
      return fn(tx as never);
    });
    prisma.client.package.findFirst.mockResolvedValue({
      id: 'new',
      name: 'X',
      description: null,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      coverages: [],
      _count: { insureds: 0 },
    } as never);
    await svc.create(
      {
        name: 'X',
        coverages: [{ name: 'c1', type: 'count', limitCount: 5, unit: 'u', description: null }],
        status: 'active',
      },
      tenant,
    );
    expect(coverages.upsertForPackageWithTx).toHaveBeenCalledTimes(1);
  });

  it('update lanza NotFound si el package no existe', async () => {
    const { svc, prisma } = build();
    prisma.client.package.findFirst.mockResolvedValue(null);
    await expect(svc.update('missing', { name: 'X' }, tenant)).rejects.toThrow(NotFoundException);
  });

  it('archive bloquea con Conflict si hay insureds activos', async () => {
    const { svc, prisma } = build();
    prisma.client.package.findFirst.mockResolvedValue({
      id: 'p1',
      _count: { insureds: 3 },
    } as never);
    await expect(svc.archive('p1', tenant)).rejects.toThrow(ConflictException);
  });

  it('archive marca status=archived y archiva coverages cuando no hay insureds activos', async () => {
    const { svc, prisma } = build();
    prisma.client.package.findFirst
      .mockResolvedValueOnce({
        id: 'p1',
        _count: { insureds: 0 },
      } as never)
      .mockResolvedValueOnce({
        id: 'p1',
        name: 'X',
        description: null,
        status: 'archived',
        createdAt: new Date(),
        updatedAt: new Date(),
        coverages: [],
        _count: { insureds: 0 },
      } as never);
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const update = jest.fn().mockResolvedValue({});
    prisma.withTenant.mockImplementation(async (fn) =>
      fn({ coverage: { updateMany }, package: { update } } as never),
    );
    const out = await svc.archive('p1', tenant);
    expect(out.status).toBe('archived');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ packageId: 'p1' }),
      }),
    );
  });
});
