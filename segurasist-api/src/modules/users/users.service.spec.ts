import { ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import { decodeCursor, encodeCursor } from './cursor';
import { UsersService, type UserCallerCtx } from './users.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_SUB = 'sub-admin-mac';
const SUPER_SUB = 'sub-super';

function adminMacCtx(): UserCallerCtx {
  return { platformAdmin: false, tenantId: TENANT_ID, callerCognitoSub: ADMIN_SUB };
}
function superCtx(): UserCallerCtx {
  return { platformAdmin: true, callerCognitoSub: SUPER_SUB };
}

interface MockBypass {
  client: {
    user: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
}

function build(): {
  svc: UsersService;
  prisma: ReturnType<typeof mockPrismaService>;
  bypass: MockBypass;
} {
  const prisma = mockPrismaService();
  const bypass: MockBypass = {
    client: {
      user: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    },
  };
  const svc = new UsersService(prisma, bypass as never);
  return { svc, prisma, bypass };
}

const sampleRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'a1111111-1111-1111-1111-111111111111',
  tenantId: TENANT_ID,
  cognitoSub: 'sub-1',
  email: 'foo@mac.local',
  fullName: 'Foo Bar',
  role: 'operator' as const,
  status: 'active' as const,
  mfaEnrolled: false,
  lastLoginAt: null,
  createdAt: new Date('2026-04-20T00:00:00Z'),
  updatedAt: new Date('2026-04-20T00:00:00Z'),
  deletedAt: null,
  ...over,
});

describe('UsersService', () => {
  describe('cursor codec', () => {
    it('round-trip encode/decode', () => {
      const c = { id: 'abc', createdAt: '2026-04-25T12:00:00.000Z' };
      expect(decodeCursor(encodeCursor(c))).toEqual(c);
    });
    it('decode devuelve null en input corrupto', () => {
      expect(decodeCursor('not-base64!!!')).toBeNull();
      const corrupt = Buffer.from(JSON.stringify({ x: 1 })).toString('base64url');
      expect(decodeCursor(corrupt)).toBeNull();
    });
  });

  describe('list', () => {
    it('aplica filtros role/status y default limit con take=limit+1', async () => {
      const { svc, prisma } = build();
      prisma.client.user.findMany.mockResolvedValue([] as never);
      await svc.list({ limit: 50, role: 'operator', status: 'active' }, adminMacCtx());
      const call = prisma.client.user.findMany.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({
        deletedAt: null,
        role: 'operator',
        status: 'active',
      });
      expect(call?.take).toBe(51);
      expect(call?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    });

    it('q dispara OR en email + fullName case-insensitive', async () => {
      const { svc, prisma } = build();
      prisma.client.user.findMany.mockResolvedValue([] as never);
      await svc.list({ limit: 50, q: 'lopez' }, adminMacCtx());
      const call = prisma.client.user.findMany.mock.calls[0]?.[0];
      const or = (call?.where as { OR?: Array<Record<string, unknown>> }).OR;
      expect(or).toHaveLength(2);
      expect(or?.[0]).toMatchObject({ email: { contains: 'lopez', mode: 'insensitive' } });
      expect(or?.[1]).toMatchObject({ fullName: { contains: 'lopez', mode: 'insensitive' } });
    });

    it('superadmin con tenantId filtra por ese tenant y usa cliente bypass', async () => {
      const { svc, prisma, bypass } = build();
      bypass.client.user.findMany.mockResolvedValue([] as never);
      await svc.list({ limit: 50, tenantId: OTHER_TENANT_ID }, superCtx());
      expect(bypass.client.user.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.user.findMany).not.toHaveBeenCalled();
      const call = bypass.client.user.findMany.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({ tenantId: OTHER_TENANT_ID });
    });

    it('superadmin sin tenantId no filtra (cross-tenant total)', async () => {
      const { svc, bypass } = build();
      bypass.client.user.findMany.mockResolvedValue([] as never);
      await svc.list({ limit: 50 }, superCtx());
      const call = bypass.client.user.findMany.mock.calls[0]?.[0];
      expect((call?.where as Record<string, unknown>).tenantId).toBeUndefined();
    });

    it('limit > 100 se clampea a 100', async () => {
      const { svc, prisma } = build();
      prisma.client.user.findMany.mockResolvedValue([] as never);
      await svc.list({ limit: 200 } as never, adminMacCtx());
      const call = prisma.client.user.findMany.mock.calls[0]?.[0];
      expect(call?.take).toBe(101);
    });

    it('mapea filas y emite nextCursor cuando hay más resultados', async () => {
      const { svc, prisma } = build();
      const rows = Array.from({ length: 3 }).map((_, i) =>
        sampleRow({ id: `id-${i}`, email: `u${i}@mac.local`, createdAt: new Date(2026, 3, 25 - i) }),
      );
      prisma.client.user.findMany.mockResolvedValue(rows as never);
      const out = await svc.list({ limit: 2 }, adminMacCtx());
      expect(out.items).toHaveLength(2);
      expect(out.nextCursor).not.toBeNull();
      const decoded = decodeCursor(out.nextCursor as string);
      expect(decoded?.id).toBe('id-1');
      // Output NO debe filtrar cognitoSub.
      expect(out.items[0]).not.toHaveProperty('cognitoSub');
    });

    it('cursor decoded añade WHERE compuesto OR', async () => {
      const { svc, prisma } = build();
      prisma.client.user.findMany.mockResolvedValue([] as never);
      const cursor = encodeCursor({ id: 'iX', createdAt: '2026-04-15T00:00:00.000Z' });
      await svc.list({ limit: 50, cursor }, adminMacCtx());
      const call = prisma.client.user.findMany.mock.calls[0]?.[0];
      expect(Array.isArray((call?.where as { AND?: unknown }).AND)).toBe(true);
    });

    it('cursor corrupto se ignora silenciosamente', async () => {
      const { svc, prisma } = build();
      prisma.client.user.findMany.mockResolvedValue([] as never);
      await svc.list({ limit: 50, cursor: 'not-base64!!!' }, adminMacCtx());
      const call = prisma.client.user.findMany.mock.calls[0]?.[0];
      expect((call?.where as { AND?: unknown }).AND).toBeUndefined();
    });
  });

  describe('create', () => {
    it('happy path admin_mac inserta vía withTenant + cognitoSub placeholder', async () => {
      const { svc, prisma } = build();
      const created = sampleRow({ status: 'invited' });
      prisma.withTenant.mockImplementation(async (fn) =>
        fn({ user: { create: jest.fn().mockResolvedValue(created) } } as never),
      );
      const out = await svc.create(
        { email: 'NEW@mac.local', fullName: 'New User', role: 'operator' },
        adminMacCtx(),
      );
      expect(prisma.withTenant).toHaveBeenCalledTimes(1);
      expect(out.email).toBe(created.email);
      expect(out.tenantId).toBe(TENANT_ID);
    });

    it('email duplicado P2002 → ConflictException con code USER_EMAIL_EXISTS', async () => {
      const { svc, prisma } = build();
      prisma.withTenant.mockImplementation(async () => {
        throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' });
      });
      try {
        await svc.create({ email: 'dup@mac.local', fullName: 'Dup', role: 'operator' }, adminMacCtx());
        fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConflictException);
        const resp = (e as ConflictException).getResponse() as { code: string };
        expect(resp.code).toBe('USER_EMAIL_EXISTS');
      }
    });

    it('superadmin sin tenantId en body → 422', async () => {
      const { svc } = build();
      await expect(
        svc.create({ email: 'a@b.c', fullName: 'A B', role: 'operator' }, superCtx()),
      ).rejects.toThrow(HttpException);
    });

    it('superadmin con tenantId usa bypass.create directamente', async () => {
      const { svc, bypass, prisma } = build();
      bypass.client.user.create.mockResolvedValue(sampleRow({ tenantId: OTHER_TENANT_ID }));
      await svc.create(
        { email: 'a@b.c', fullName: 'A B', role: 'operator', tenantId: OTHER_TENANT_ID },
        superCtx(),
      );
      expect(bypass.client.user.create).toHaveBeenCalledTimes(1);
      expect(prisma.withTenant).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('actualiza fullName parcial vía withTenant', async () => {
      const { svc, prisma } = build();
      prisma.client.user.findFirst.mockResolvedValue(sampleRow() as never);
      const update = jest.fn().mockResolvedValue(sampleRow({ fullName: 'Renombrado' }));
      prisma.withTenant.mockImplementation(async (fn) => fn({ user: { update } } as never));
      const out = await svc.update('a1', { fullName: 'Renombrado' }, adminMacCtx());
      expect(out.fullName).toBe('Renombrado');
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { fullName: 'Renombrado' } }));
    });

    it('NotFound si la fila no existe (RLS scoping)', async () => {
      const { svc, prisma } = build();
      prisma.client.user.findFirst.mockResolvedValue(null);
      await expect(svc.update('missing', { fullName: 'X' }, adminMacCtx())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('admin_mac no puede asignar role=admin_segurasist (defensa redundante)', async () => {
      const { svc, prisma } = build();
      prisma.client.user.findFirst.mockResolvedValue(sampleRow() as never);
      await expect(svc.update('a1', { role: 'admin_segurasist' as never }, adminMacCtx())).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('softDelete', () => {
    it('marca status=disabled', async () => {
      const { svc, prisma } = build();
      prisma.client.user.findFirst.mockResolvedValue(sampleRow({ cognitoSub: 'sub-other' }) as never);
      const update = jest.fn().mockResolvedValue(sampleRow({ status: 'disabled' }));
      prisma.withTenant.mockImplementation(async (fn) => fn({ user: { update } } as never));
      const out = await svc.softDelete('a1', adminMacCtx());
      expect(out.status).toBe('disabled');
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'disabled' } }));
    });

    it('rechaza self-delete cuando cognitoSub coincide → USER_CANNOT_DELETE_SELF (422)', async () => {
      const { svc, prisma } = build();
      prisma.client.user.findFirst.mockResolvedValue(sampleRow({ cognitoSub: ADMIN_SUB }) as never);
      try {
        await svc.softDelete('a1', adminMacCtx());
        fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        const exc = e as HttpException;
        expect(exc.getStatus()).toBe(422);
        const resp = exc.getResponse() as { code: string };
        expect(resp.code).toBe('USER_CANNOT_DELETE_SELF');
      }
    });

    it('NotFound si la fila no existe', async () => {
      const { svc, prisma } = build();
      prisma.client.user.findFirst.mockResolvedValue(null);
      await expect(svc.softDelete('missing', adminMacCtx())).rejects.toThrow(NotFoundException);
    });
  });
});
