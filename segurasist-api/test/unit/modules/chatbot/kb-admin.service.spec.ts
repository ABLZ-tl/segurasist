/**
 * Sprint 5 — S5-3 unit tests del KbAdminService.
 *
 * Cobertura:
 *   1. CRUD básico (create/update/delete soft) con audit emitido.
 *   2. RLS lógica: tenant_admin no puede ver/editar entries de otro tenant.
 *   3. Superadmin puede setear `tenantId` en body para crear entries
 *      cross-tenant; tenant_admin lo ignora silenciosamente.
 *   4. test-match scoring (delegación al matcher).
 *   5. CSV bulk import — insert + upsert + skipped malformados.
 */
import type { PrismaService } from '@common/prisma/prisma.service';
import type { AuditContextFactory } from '@modules/audit/audit-context.factory';
import type { AuditWriterService } from '@modules/audit/audit-writer.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { KbAdminService } from '../../../../src/modules/chatbot/kb-admin/kb-admin.service';
import { KbMatcherService } from '../../../../src/modules/chatbot/kb-matcher.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const ENTRY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_A,
    category: 'coverages',
    question: 'Cobertura hospitalaria',
    answer: 'Tu plan incluye habitación standard...',
    keywords: ['hospital', 'cobertura'],
    synonyms: { hospital: ['clinica'] },
    priority: 0,
    enabled: true,
    status: 'published',
    version: 1,
    deletedAt: null,
    createdAt: new Date('2026-04-28T00:00:00Z'),
    updatedAt: new Date('2026-04-28T00:00:00Z'),
    ...overrides,
  };
}

function buildService(
  prismaOverrides?: (p: DeepMockProxy<PrismaService>) => void,
): {
  svc: KbAdminService;
  prisma: DeepMockProxy<PrismaService>;
  audit: { record: jest.Mock };
  matcher: KbMatcherService;
} {
  const prisma = mockDeep<PrismaService>();
  prismaOverrides?.(prisma);
  const audit = { record: jest.fn() };
  const auditCtx = {
    fromRequest: jest.fn(() => ({ actorId: 'u-1', tenantId: TENANT_A, ip: '10.0.0.1' })),
  } as unknown as AuditContextFactory;
  const matcher = new KbMatcherService();
  const svc = new KbAdminService(
    prisma as unknown as PrismaService,
    matcher,
    audit as unknown as AuditWriterService,
    auditCtx,
  );
  return { svc, prisma, audit, matcher };
}

describe('KbAdminService', () => {
  describe('create', () => {
    it('crea entry usando tenant del JWT cuando es tenant_admin', async () => {
      const { svc, prisma, audit } = buildService((p) => {
        p.client.chatKb.create.mockResolvedValue(makeRow() as never);
      });

      const view = await svc.create(
        { roles: ['admin_mac'], tenantId: TENANT_A },
        {
          intent: 'coverages',
          title: 'Cobertura hospitalaria',
          body: 'Tu plan incluye...',
          keywords: ['hospital'],
          priority: 0,
          enabled: true,
        },
      );

      expect(view.tenantId).toBe(TENANT_A);
      expect(view.intent).toBe('coverages');
      expect(view.title).toBe('Cobertura hospitalaria');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          resourceType: 'chatbot.kb_entry',
          tenantId: TENANT_A,
          payloadDiff: expect.objectContaining({ subAction: 'kb_entry_created' }),
        }),
      );
    });

    it('tenant_admin NO puede forzar tenantId distinto en body — usa el JWT', async () => {
      const { svc, prisma } = buildService((p) => {
        (p.client.chatKb.create as jest.Mock).mockImplementation(
          (args: { data: { tenantId: string } }) =>
            Promise.resolve(makeRow({ tenantId: args.data.tenantId }) as never),
        );
      });

      const view = await svc.create(
        { roles: ['admin_mac'], tenantId: TENANT_A },
        {
          intent: 'claims',
          title: 'Claims info',
          body: 'body',
          keywords: ['k'],
          priority: 0,
          enabled: true,
          tenantId: TENANT_B, // intento override → ignorado
        },
      );

      expect(view.tenantId).toBe(TENANT_A);
      expect(prisma.client.chatKb.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT_A }) }),
      );
    });

    it('superadmin puede setear tenantId en body', async () => {
      const { svc, prisma } = buildService((p) => {
        (p.client.chatKb.create as jest.Mock).mockImplementation(
          (args: { data: { tenantId: string } }) =>
            Promise.resolve(makeRow({ tenantId: args.data.tenantId }) as never),
        );
      });

      const view = await svc.create(
        { roles: ['admin_segurasist'], tenantId: undefined },
        {
          intent: 'claims',
          title: 'X',
          body: 'X',
          keywords: ['k'],
          priority: 0,
          enabled: true,
          tenantId: TENANT_B,
        },
      );

      expect(view.tenantId).toBe(TENANT_B);
    });

    it('superadmin sin tenantId en body NI en JWT → ForbiddenException', async () => {
      const { svc } = buildService();
      await expect(
        svc.create(
          { roles: ['admin_segurasist'], tenantId: undefined },
          {
            intent: 'x',
            title: 't',
            body: 'b',
            keywords: ['k'],
            priority: 0,
            enabled: true,
          },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('update', () => {
    it('404 si la entry no existe', async () => {
      const { svc } = buildService((p) => {
        p.client.chatKb.findFirst.mockResolvedValue(null);
      });
      await expect(
        svc.update({ roles: ['admin_mac'], tenantId: TENANT_A }, ENTRY_ID, {
          title: 'nuevo',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('tenant_admin de tenant A → 404 al editar entry de tenant B', async () => {
      const { svc } = buildService((p) => {
        p.client.chatKb.findFirst.mockResolvedValue(makeRow({ tenantId: TENANT_B }) as never);
      });
      await expect(
        svc.update({ roles: ['admin_mac'], tenantId: TENANT_A }, ENTRY_ID, {
          title: 'hack',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('audit emit con changedFields cuando update OK', async () => {
      const { svc, audit } = buildService((p) => {
        p.client.chatKb.findFirst.mockResolvedValue(makeRow() as never);
        p.client.chatKb.update.mockResolvedValue(makeRow({ priority: 99 }) as never);
      });
      await svc.update({ roles: ['admin_mac'], tenantId: TENANT_A }, ENTRY_ID, {
        priority: 99,
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          resourceType: 'chatbot.kb_entry',
          payloadDiff: expect.objectContaining({
            subAction: 'kb_entry_updated',
            changedFields: ['priority'],
          }),
        }),
      );
    });
  });

  describe('softDelete', () => {
    it('marca deletedAt y emite audit', async () => {
      const { svc, prisma, audit } = buildService((p) => {
        p.client.chatKb.findFirst.mockResolvedValue(makeRow() as never);
        p.client.chatKb.update.mockResolvedValue(makeRow({ deletedAt: new Date() }) as never);
      });
      await svc.softDelete({ roles: ['admin_mac'], tenantId: TENANT_A }, ENTRY_ID);
      expect(prisma.client.chatKb.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date), enabled: false }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'delete',
          payloadDiff: expect.objectContaining({ subAction: 'kb_entry_deleted' }),
        }),
      );
    });
  });

  describe('testMatch', () => {
    it('devuelve score>=1 cuando query incluye keyword canónica', async () => {
      const { svc } = buildService((p) => {
        p.client.chatKb.findFirst.mockResolvedValue(
          makeRow({ keywords: ['hospital', 'cobertura'] }) as never,
        );
      });
      const result = await svc.testMatch(
        { roles: ['admin_mac'], tenantId: TENANT_A },
        ENTRY_ID,
        '¿qué hospital cubre mi póliza?',
      );
      expect(result.matched).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(1);
      expect(result.matchedKeywords).toEqual(expect.arrayContaining(['hospital']));
    });

    it('devuelve matched=false cuando no hay overlap', async () => {
      const { svc } = buildService((p) => {
        p.client.chatKb.findFirst.mockResolvedValue(
          makeRow({ keywords: ['hospital'] }) as never,
        );
      });
      const result = await svc.testMatch(
        { roles: ['admin_mac'], tenantId: TENANT_A },
        ENTRY_ID,
        'hola buenas tardes',
      );
      expect(result.matched).toBe(false);
      expect(result.score).toBe(0);
    });

    it('cross-tenant denial: tenant_admin de A no testea entry de B', async () => {
      const { svc } = buildService((p) => {
        p.client.chatKb.findFirst.mockResolvedValue(makeRow({ tenantId: TENANT_B }) as never);
      });
      await expect(
        svc.testMatch({ roles: ['admin_mac'], tenantId: TENANT_A }, ENTRY_ID, 'hospital'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    it('aplica tenant scope para tenant_admin', async () => {
      const { svc, prisma } = buildService((p) => {
        p.client.chatKb.findMany.mockResolvedValue([makeRow()] as never);
        p.client.chatKb.count.mockResolvedValue(1);
      });
      const result = await svc.list(
        { roles: ['admin_mac'], tenantId: TENANT_A },
        { limit: 50, offset: 0 },
      );
      expect(result.total).toBe(1);
      expect(prisma.client.chatKb.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_A, deletedAt: null }),
        }),
      );
    });

    it('search por title/intent (q) usa OR contains insensitive', async () => {
      const { svc, prisma } = buildService((p) => {
        p.client.chatKb.findMany.mockResolvedValue([] as never);
        p.client.chatKb.count.mockResolvedValue(0);
      });
      await svc.list(
        { roles: ['admin_mac'], tenantId: TENANT_A },
        { limit: 50, offset: 0, q: 'hospital' },
      );
      const arg = prisma.client.chatKb.findMany.mock.calls[0]![0] as { where: { OR: unknown[] } };
      expect(arg.where.OR).toBeDefined();
      expect(arg.where.OR.length).toBe(2);
    });
  });

  describe('importCsv', () => {
    it('inserta filas válidas + skipped en malformadas', async () => {
      const { svc, prisma } = buildService((p) => {
        (p.client.chatKb.create as jest.Mock).mockImplementation(
          (args: { data: Record<string, unknown> }) =>
            Promise.resolve(makeRow(args.data) as never),
        );
      });
      const csv = [
        'intent,title,body,keywords,priority,enabled',
        'coverages,Plan,Cobertura X,"hospital|clinica",10,true',
        ',,,,,', // malformed (no intent/title/body)
        'claims,Claim,Reporta,"reporta",5,true',
      ].join('\n');
      const r = await svc.importCsv(
        { roles: ['admin_mac'], tenantId: TENANT_A },
        { csv, upsert: false },
      );
      expect(r.inserted).toBe(2);
      expect(r.skipped).toBe(1);
      expect(r.errors.length).toBe(1);
      expect(prisma.client.chatKb.create).toHaveBeenCalledTimes(2);
    });

    it('upsert: actualiza si ya existe (tenantId, intent)', async () => {
      const { svc, prisma } = buildService((p) => {
        p.client.chatKb.findFirst.mockResolvedValue(makeRow() as never);
        (p.client.chatKb.update as jest.Mock).mockImplementation(
          (args: { data: Record<string, unknown> }) =>
            Promise.resolve(makeRow(args.data) as never),
        );
      });
      const csv = ['intent,title,body,keywords', 'coverages,Plan,Body update,key1'].join('\n');
      const r = await svc.importCsv(
        { roles: ['admin_mac'], tenantId: TENANT_A },
        { csv, upsert: true },
      );
      expect(r.updated).toBe(1);
      expect(r.inserted).toBe(0);
      expect(prisma.client.chatKb.update).toHaveBeenCalled();
    });
  });
});
