import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import { decodeCursor, encodeCursor } from './cursor';
import { InsuredsService } from './insureds.service';

describe('InsuredsService', () => {
  const tenant = { id: '11111111-1111-1111-1111-111111111111' };

  function build(): {
    svc: InsuredsService;
    prisma: ReturnType<typeof mockPrismaService>;
  } {
    const prisma = mockPrismaService();
    const svc = new InsuredsService(prisma);
    return { svc, prisma };
  }

  describe('cursor codec', () => {
    it('round-trip encode/decode', () => {
      const c = { id: 'abc', createdAt: '2026-04-25T12:00:00.000Z' };
      expect(decodeCursor(encodeCursor(c))).toEqual(c);
    });
    it('decode devuelve null si la entrada es basura', () => {
      expect(decodeCursor('not-base64!!!')).toBeNull();
    });
    it('decode devuelve null si el JSON no tiene id', () => {
      const corrupt = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url');
      expect(decodeCursor(corrupt)).toBeNull();
    });
  });

  describe('list', () => {
    it('aplica filtros de status y packageId y respeta default limit', async () => {
      const { svc, prisma } = build();
      prisma.client.insured.findMany.mockResolvedValue([] as never);
      prisma.client.certificate.findMany.mockResolvedValue([] as never);
      await svc.list(
        {
          limit: 50,
          status: 'active',
          packageId: '22222222-2222-2222-2222-222222222222',
        },
        tenant,
      );
      const call = prisma.client.insured.findMany.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({
        status: 'active',
        packageId: '22222222-2222-2222-2222-222222222222',
        deletedAt: null,
      });
      expect(call?.take).toBe(51);
    });

    it('aplica búsqueda fuzzy q en (fullName, curp, rfc)', async () => {
      const { svc, prisma } = build();
      prisma.client.insured.findMany.mockResolvedValue([] as never);
      prisma.client.certificate.findMany.mockResolvedValue([] as never);
      await svc.list({ limit: 50, q: 'lopez' }, tenant);
      const call = prisma.client.insured.findMany.mock.calls[0]?.[0];
      expect((call?.where as { OR?: unknown }).OR).toBeDefined();
      const or = (call?.where as { OR: Array<Record<string, unknown>> }).OR;
      expect(or.length).toBe(3);
      expect(or[0]).toMatchObject({ fullName: { contains: 'lopez', mode: 'insensitive' } });
    });

    it('mappea filas a InsuredListItem y nextCursor cuando hay más resultados', async () => {
      const { svc, prisma } = build();
      const now = new Date('2026-04-20T00:00:00Z');
      prisma.client.insured.findMany.mockResolvedValue(
        Array.from({ length: 3 }).map((_, i) => ({
          id: `i${i}`,
          curp: `CURP${i}`,
          rfc: null,
          fullName: `User ${i}`,
          packageId: 'p1',
          status: 'active',
          validFrom: now,
          validTo: new Date('2027-04-20'),
          email: null,
          createdAt: now,
          package: { id: 'p1', name: 'Básico' },
        })) as never,
      );
      prisma.client.certificate.findMany.mockResolvedValue([] as never);
      const out = await svc.list({ limit: 2 }, tenant);
      expect(out.items).toHaveLength(2);
      expect(out.nextCursor).not.toBeNull();
      expect(out.items[0]?.packageName).toBe('Básico');
    });

    it('respeta cursor decodificado y arma WHERE compuesto', async () => {
      const { svc, prisma } = build();
      prisma.client.insured.findMany.mockResolvedValue([] as never);
      prisma.client.certificate.findMany.mockResolvedValue([] as never);
      const cursor = encodeCursor({ id: 'iX', createdAt: '2026-04-15T00:00:00.000Z' });
      await svc.list({ limit: 50, cursor }, tenant);
      const call = prisma.client.insured.findMany.mock.calls[0]?.[0];
      const ANDcond = (call?.where as { AND?: Array<unknown> }).AND;
      expect(Array.isArray(ANDcond)).toBe(true);
    });

    it('flag hasBounce true cuando el insured tiene certificate con email_event bounced', async () => {
      const { svc, prisma } = build();
      const now = new Date();
      prisma.client.insured.findMany.mockResolvedValue([
        {
          id: 'i1',
          curp: 'C',
          rfc: null,
          fullName: 'X',
          packageId: 'p',
          status: 'active',
          validFrom: now,
          validTo: now,
          email: 'a@b.c',
          createdAt: now,
          package: { id: 'p', name: 'P' },
        },
      ] as never);
      prisma.client.certificate.findMany.mockResolvedValue([{ id: 'cert1', insuredId: 'i1' }] as never);
      prisma.client.emailEvent.findMany.mockResolvedValue([{ certificateId: 'cert1' }] as never);
      const out = await svc.list({ limit: 50 }, tenant);
      expect(out.items[0]?.hasBounce).toBe(true);
    });

    it('bouncedOnly=true filtra a sólo los que tienen bounce', async () => {
      const { svc, prisma } = build();
      const now = new Date();
      prisma.client.insured.findMany.mockResolvedValue([
        {
          id: 'i1',
          curp: 'C',
          rfc: null,
          fullName: 'X',
          packageId: 'p',
          status: 'active',
          validFrom: now,
          validTo: now,
          email: null,
          createdAt: now,
          package: { id: 'p', name: 'P' },
        },
        {
          id: 'i2',
          curp: 'D',
          rfc: null,
          fullName: 'Y',
          packageId: 'p',
          status: 'active',
          validFrom: now,
          validTo: now,
          email: null,
          createdAt: now,
          package: { id: 'p', name: 'P' },
        },
      ] as never);
      prisma.client.certificate.findMany.mockResolvedValue([{ id: 'cert1', insuredId: 'i1' }] as never);
      prisma.client.emailEvent.findMany.mockResolvedValue([{ certificateId: 'cert1' }] as never);
      const out = await svc.list({ limit: 50, bouncedOnly: true }, tenant);
      expect(out.items.map((i) => i.id)).toEqual(['i1']);
    });
  });

  describe('CRUD', () => {
    it('findOne lanza NotFound si no existe', async () => {
      const { svc, prisma } = build();
      prisma.client.insured.findFirst.mockResolvedValue(null);
      await expect(svc.findOne('missing', tenant)).rejects.toThrow(NotFoundException);
    });

    it('create lanza Conflict en P2002 (CURP duplicado)', async () => {
      const { svc, prisma } = build();
      prisma.withTenant.mockImplementation(async () => {
        throw new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '5.0',
        });
      });
      await expect(
        svc.create(
          {
            curp: 'AAAA111111HDFXXXA1',
            fullName: 'X',
            dob: '1990-01-01',
            packageId: '33333333-3333-3333-3333-333333333333',
            validFrom: '2026-01-01',
            validTo: '2027-01-01',
          },
          tenant,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('softDelete marca deletedAt + status=cancelled', async () => {
      const { svc, prisma } = build();
      prisma.client.insured.findFirst.mockResolvedValue({ id: 'i1' } as never);
      const update = jest.fn().mockResolvedValue({});
      prisma.withTenant.mockImplementation(async (fn) => fn({ insured: { update } } as never));
      await svc.softDelete('i1', tenant);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'cancelled' }),
        }),
      );
    });
  });
});
