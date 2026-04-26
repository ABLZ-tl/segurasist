import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor';
import { AuditService, type AuditCallerCtx } from './audit.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-2222-2222-222222222222';

interface MockBypass {
  client: { auditLog: { findMany: jest.Mock } };
}

function build(): {
  svc: AuditService;
  prisma: ReturnType<typeof mockPrismaService>;
  bypass: MockBypass;
} {
  const prisma = mockPrismaService();
  const bypass: MockBypass = { client: { auditLog: { findMany: jest.fn() } } };
  const svc = new AuditService(prisma, bypass as never);
  return { svc, prisma, bypass };
}

const adminMacCtx = (): AuditCallerCtx => ({ platformAdmin: false, tenantId: TENANT_ID });
const superCtx = (): AuditCallerCtx => ({ platformAdmin: true });

const sampleRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'a1111111-1111-1111-1111-111111111111',
  tenantId: TENANT_ID,
  actorId: null,
  action: 'create' as const,
  resourceType: 'users',
  resourceId: null,
  ip: '127.0.0.1',
  userAgent: 'jest',
  payloadDiff: null,
  traceId: 't1',
  occurredAt: new Date('2026-04-25T12:00:00Z'),
  prevHash: '0'.repeat(64),
  rowHash: '1'.repeat(64),
  mirroredToS3: false,
  mirroredAt: null,
  ...over,
});

describe('AuditService', () => {
  describe('cursor codec', () => {
    it('round-trip encode/decode', () => {
      const c = { id: 'abc', occurredAt: '2026-04-25T12:00:00.000Z' };
      expect(decodeAuditCursor(encodeAuditCursor(c))).toEqual(c);
    });
    it('decode null en input corrupto', () => {
      expect(decodeAuditCursor('not-base64!!!')).toBeNull();
      expect(decodeAuditCursor(Buffer.from('{"x":1}').toString('base64url'))).toBeNull();
    });
  });

  describe('query', () => {
    it('filtros individuales (action / resourceType / resourceId / actorId)', async () => {
      const { svc, prisma } = build();
      prisma.client.auditLog.findMany.mockResolvedValue([] as never);
      await svc.query(
        {
          limit: 50,
          action: 'create',
          resourceType: 'users',
          resourceId: 'r1',
          actorId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        },
        adminMacCtx(),
      );
      const call = prisma.client.auditLog.findMany.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({
        action: 'create',
        resourceType: 'users',
        resourceId: 'r1',
        actorId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      });
      expect(call?.orderBy).toEqual([{ occurredAt: 'desc' }, { id: 'desc' }]);
      expect(call?.take).toBe(51);
    });

    it('filtro from/to combinados arman occurredAt rango', async () => {
      const { svc, prisma } = build();
      prisma.client.auditLog.findMany.mockResolvedValue([] as never);
      await svc.query(
        { limit: 50, from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T23:59:59.000Z' },
        adminMacCtx(),
      );
      const call = prisma.client.auditLog.findMany.mock.calls[0]?.[0];
      const occurred = (call?.where as { occurredAt?: { gte?: Date; lte?: Date } }).occurredAt;
      expect(occurred?.gte).toBeInstanceOf(Date);
      expect(occurred?.lte).toBeInstanceOf(Date);
    });

    it('superadmin con tenantId aplica filtro y usa cliente bypass', async () => {
      const { svc, prisma, bypass } = build();
      bypass.client.auditLog.findMany.mockResolvedValue([] as never);
      await svc.query({ limit: 50, tenantId: OTHER_TENANT_ID }, superCtx());
      expect(bypass.client.auditLog.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.client.auditLog.findMany).not.toHaveBeenCalled();
      const call = bypass.client.auditLog.findMany.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({ tenantId: OTHER_TENANT_ID });
    });

    it('caller no-superadmin ignora query.tenantId (defensa)', async () => {
      const { svc, prisma } = build();
      prisma.client.auditLog.findMany.mockResolvedValue([] as never);
      await svc.query({ limit: 50, tenantId: OTHER_TENANT_ID }, adminMacCtx());
      const call = prisma.client.auditLog.findMany.mock.calls[0]?.[0];
      expect((call?.where as Record<string, unknown>).tenantId).toBeUndefined();
    });

    it('empty result → nextCursor null', async () => {
      const { svc, prisma } = build();
      prisma.client.auditLog.findMany.mockResolvedValue([] as never);
      const out = await svc.query({ limit: 50 }, adminMacCtx());
      expect(out.items).toEqual([]);
      expect(out.nextCursor).toBeNull();
    });

    it('más de limit resultados → items truncados a limit + nextCursor poblado', async () => {
      const { svc, prisma } = build();
      const rows = Array.from({ length: 3 }).map((_, i) =>
        sampleRow({ id: `id-${i}`, occurredAt: new Date(2026, 3, 25 - i, 10) }),
      );
      prisma.client.auditLog.findMany.mockResolvedValue(rows as never);
      const out = await svc.query({ limit: 2 }, adminMacCtx());
      expect(out.items).toHaveLength(2);
      expect(out.nextCursor).not.toBeNull();
      const decoded = decodeAuditCursor(out.nextCursor as string);
      expect(decoded?.id).toBe('id-1');
    });

    it('cursor decoded añade WHERE compuesto AND', async () => {
      const { svc, prisma } = build();
      prisma.client.auditLog.findMany.mockResolvedValue([] as never);
      const cursor = encodeAuditCursor({ id: 'iX', occurredAt: '2026-04-15T00:00:00.000Z' });
      await svc.query({ limit: 50, cursor }, adminMacCtx());
      const call = prisma.client.auditLog.findMany.mock.calls[0]?.[0];
      expect(Array.isArray((call?.where as { AND?: unknown }).AND)).toBe(true);
    });

    it('cursor corrupto se ignora', async () => {
      const { svc, prisma } = build();
      prisma.client.auditLog.findMany.mockResolvedValue([] as never);
      await svc.query({ limit: 50, cursor: 'not-base64!!!' }, adminMacCtx());
      const call = prisma.client.auditLog.findMany.mock.calls[0]?.[0];
      expect((call?.where as { AND?: unknown }).AND).toBeUndefined();
    });
  });
});
