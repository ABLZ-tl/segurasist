import type { AuthUser } from '@common/decorators/current-user.decorator';
import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import type { AuditWriterService } from '@modules/audit/audit-writer.service';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import { decodeCursor, encodeCursor } from './cursor';
import { InsuredsService, type InsuredsScope } from './insureds.service';

describe('InsuredsService', () => {
  const tenant = { id: '11111111-1111-1111-1111-111111111111' };
  // Scope tenant-scoped por defecto para preservar behaviour de los tests
  // existentes (path RLS, no platformAdmin).
  const scope: InsuredsScope = { platformAdmin: false, tenantId: tenant.id, actorId: 'u1' };

  function build(): {
    svc: InsuredsService;
    prisma: ReturnType<typeof mockPrismaService>;
    bypass: DeepMockProxy<PrismaBypassRlsService>;
    audit: DeepMockProxy<AuditWriterService>;
  } {
    const prisma = mockPrismaService();
    const bypass = mockDeep<PrismaBypassRlsService>();
    const audit = mockDeep<AuditWriterService>();
    const svc = new InsuredsService(prisma, bypass, audit);
    return { svc, prisma, bypass, audit };
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
        scope,
      );
      const call = prisma.client.insured.findMany.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({
        status: 'active',
        packageId: '22222222-2222-2222-2222-222222222222',
        deletedAt: null,
      });
      expect(call?.take).toBe(51);
    });

    it('aplica búsqueda fuzzy q en (fullName, curp, rfc, metadata.numeroEmpleadoExterno)', async () => {
      const { svc, prisma } = build();
      prisma.client.insured.findMany.mockResolvedValue([] as never);
      prisma.client.certificate.findMany.mockResolvedValue([] as never);
      await svc.list({ limit: 50, q: 'lopez' }, scope);
      const call = prisma.client.insured.findMany.mock.calls[0]?.[0];
      expect((call?.where as { OR?: unknown }).OR).toBeDefined();
      const or = (call?.where as { OR: Array<Record<string, unknown>> }).OR;
      // S3-07 — agregamos búsqueda en metadata.numeroEmpleadoExterno como
      // proxy de "número de póliza".
      expect(or.length).toBe(4);
      expect(or[0]).toMatchObject({ fullName: { contains: 'lopez', mode: 'insensitive' } });
      expect(or[3]).toMatchObject({
        metadata: { path: ['numeroEmpleadoExterno'], string_contains: 'lopez' },
      });
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
      const out = await svc.list({ limit: 2 }, scope);
      expect(out.items).toHaveLength(2);
      expect(out.nextCursor).not.toBeNull();
      expect(out.items[0]?.packageName).toBe('Básico');
    });

    it('respeta cursor decodificado y arma WHERE compuesto', async () => {
      const { svc, prisma } = build();
      prisma.client.insured.findMany.mockResolvedValue([] as never);
      prisma.client.certificate.findMany.mockResolvedValue([] as never);
      const cursor = encodeCursor({ id: 'iX', createdAt: '2026-04-15T00:00:00.000Z' });
      await svc.list({ limit: 50, cursor }, scope);
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
      const out = await svc.list({ limit: 50 }, scope);
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
      const out = await svc.list({ limit: 50, bouncedOnly: true }, scope);
      expect(out.items.map((i) => i.id)).toEqual(['i1']);
    });
  });

  describe('CRUD', () => {
    it('findOne lanza NotFound si no existe', async () => {
      const { svc, prisma } = build();
      prisma.client.insured.findFirst.mockResolvedValue(null);
      await expect(svc.findOne('missing', scope)).rejects.toThrow(NotFoundException);
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

  // -------------------------------------------------------------------------
  // M2 — Bug deferred audit Sprint 1: superadmin cross-tenant.
  // El service expone un path polimórfico via `InsuredsScope.platformAdmin`:
  // true → bypass client (cross-tenant), false → request-scoped (RLS).
  // -------------------------------------------------------------------------
  describe('platformAdmin (cross-tenant bypass)', () => {
    it('list con platformAdmin=true sin tenantId usa el bypass client y NO filtra por tenant', async () => {
      const { svc, prisma, bypass } = build();
      bypass.client.insured.findMany.mockResolvedValue([] as never);
      bypass.client.certificate.findMany.mockResolvedValue([] as never);
      await svc.list({ limit: 50 }, { platformAdmin: true, actorId: 'super-1' });
      // No usa el client request-scoped:
      expect(prisma.client.insured.findMany).not.toHaveBeenCalled();
      expect(bypass.client.insured.findMany).toHaveBeenCalledTimes(1);
      const call = bypass.client.insured.findMany.mock.calls[0]?.[0];
      // Sin tenantId: el WHERE no debe restringir por tenant.
      expect((call?.where as { tenantId?: unknown }).tenantId).toBeUndefined();
    });

    it('list con platformAdmin=true + tenantId aplica el filtro tenantId', async () => {
      const { svc, bypass } = build();
      bypass.client.insured.findMany.mockResolvedValue([] as never);
      bypass.client.certificate.findMany.mockResolvedValue([] as never);
      const someTenant = '99999999-9999-9999-9999-999999999999';
      await svc.list({ limit: 50 }, { platformAdmin: true, tenantId: someTenant, actorId: 'super-1' });
      const call = bypass.client.insured.findMany.mock.calls[0]?.[0];
      expect((call?.where as { tenantId?: string }).tenantId).toBe(someTenant);
    });

    it('findOne con platformAdmin=true usa bypass client', async () => {
      const { svc, prisma, bypass } = build();
      bypass.client.insured.findFirst.mockResolvedValue({ id: 'i1' } as never);
      await svc.findOne('i1', { platformAdmin: true, actorId: 'super-1' });
      expect(prisma.client.insured.findFirst).not.toHaveBeenCalled();
      expect(bypass.client.insured.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // S3-06 — Vista 360°.
  // -------------------------------------------------------------------------
  describe('find360', () => {
    const insuredId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
    const now = new Date('2026-04-25T12:00:00Z');
    const baseInsured = {
      id: insuredId,
      tenantId: tenant.id,
      curp: 'AAAA800101HDFRRR01',
      rfc: null,
      fullName: 'Carmen López',
      dob: new Date('1980-01-01'),
      email: 'carmen@example.com',
      phone: '+525555555555',
      packageId: 'p1',
      validFrom: new Date('2026-01-01'),
      validTo: new Date('2027-01-01'),
      status: 'active' as const,
      metadata: { entidad: 'CDMX', numeroEmpleadoExterno: 'EMP-1234' },
      createdAt: now,
      updatedAt: now,
      package: { id: 'p1', name: 'Plan Plus' },
      beneficiaries: [
        {
          id: 'b1',
          fullName: 'Hijo López',
          dob: new Date('2010-05-10'),
          relationship: 'child',
        },
      ],
    };

    function seedFulfilledClient(prisma: ReturnType<typeof mockPrismaService>) {
      prisma.client.insured.findFirst.mockResolvedValue(baseInsured as never);
      prisma.client.coverage.findMany.mockResolvedValue([
        {
          id: 'cov1',
          packageId: 'p1',
          name: 'Consultas',
          type: 'consultation',
          limitCount: 12,
          limitAmount: null,
          createdAt: now,
        },
        {
          id: 'cov2',
          packageId: 'p1',
          name: 'Estudios',
          type: 'laboratory',
          limitCount: null,
          limitAmount: '5000.00',
          createdAt: now,
        },
      ] as never);
      prisma.client.claim.findMany.mockResolvedValue([
        {
          id: 'cl1',
          insuredId,
          type: 'consultation',
          reportedAt: now,
          description: 'Consulta de rutina',
          status: 'reported',
          amountEstimated: '350.00',
        },
      ] as never);
      prisma.client.certificate.findMany.mockResolvedValue([
        {
          id: 'cert1',
          insuredId,
          version: 2,
          issuedAt: now,
          validTo: new Date('2027-01-01'),
          status: 'issued',
          hash: 'abc',
          qrPayload: 'qr-1',
        },
      ] as never);
      prisma.client.auditLog.findMany.mockResolvedValue([
        {
          id: 'au1',
          action: 'read',
          actorId: 'u-actor-1',
          resourceType: 'insureds',
          resourceId: insuredId,
          ip: '10.0.0.1',
          occurredAt: now,
          payloadDiff: { subAction: 'viewed_360' },
        },
      ] as never);
      prisma.client.coverageUsage.findMany.mockResolvedValue([
        { id: 'u1', insuredId, coverageId: 'cov1', usedAt: now, amount: null },
        { id: 'u2', insuredId, coverageId: 'cov1', usedAt: now, amount: null },
        { id: 'u3', insuredId, coverageId: 'cov2', usedAt: now, amount: '120.50' },
      ] as never);
      prisma.client.user.findMany.mockResolvedValue([{ id: 'u-actor-1', email: 'op@mac.local' }] as never);
    }

    it('happy path: arma las 5 secciones en paralelo y mappea Decimal/dates', async () => {
      const { svc, prisma } = build();
      seedFulfilledClient(prisma);

      const out = await svc.find360(insuredId, scope);

      // 1) Insured base.
      expect(out.insured.id).toBe(insuredId);
      expect(out.insured.dob).toBe('1980-01-01');
      expect(out.insured.packageName).toBe('Plan Plus');
      expect(out.insured.entidad).toBe('CDMX');
      expect(out.insured.numeroEmpleadoExterno).toBe('EMP-1234');
      expect(out.insured.beneficiaries).toHaveLength(1);
      expect(out.insured.beneficiaries[0]?.relationship).toBe('child');

      // 2) Coberturas con consumo agregado.
      expect(out.coverages).toHaveLength(2);
      const consultas = out.coverages.find((c) => c.id === 'cov1');
      expect(consultas?.type).toBe('count');
      expect(consultas?.limit).toBe(12);
      expect(consultas?.used).toBe(2); // 2 usages count.
      const estudios = out.coverages.find((c) => c.id === 'cov2');
      expect(estudios?.type).toBe('amount');
      expect(estudios?.limit).toBe(5000);
      expect(estudios?.used).toBeCloseTo(120.5);

      // 3) Eventos = claims.
      expect(out.events).toHaveLength(1);
      expect(out.events[0]?.amountEstimated).toBe(350);

      // 4) Certificados.
      expect(out.certificates).toHaveLength(1);
      expect(out.certificates[0]?.version).toBe(2);

      // 5) Audit con email del actor hidratado.
      expect(out.audit).toHaveLength(1);
      expect(out.audit[0]?.actorEmail).toBe('op@mac.local');
      expect(out.audit[0]?.payloadDiff).toEqual({ subAction: 'viewed_360' });
    });

    it('lanza NotFoundException si el insured no existe (anti-enumeration)', async () => {
      const { svc, prisma } = build();
      prisma.client.insured.findFirst.mockResolvedValue(null);
      await expect(svc.find360(insuredId, scope)).rejects.toThrow(NotFoundException);
    });

    it('persiste audit log con action=read y subAction=viewed_360', async () => {
      const { svc, prisma, audit } = build();
      seedFulfilledClient(prisma);
      await svc.find360(insuredId, scope, { ip: '189.1.2.3', userAgent: 'jest', traceId: 't1' });
      expect(audit.record).toHaveBeenCalledTimes(1);
      const evt = audit.record.mock.calls[0]?.[0];
      expect(evt).toMatchObject({
        tenantId: tenant.id,
        actorId: 'u1',
        action: 'read',
        resourceType: 'insureds',
        resourceId: insuredId,
        ip: '189.1.2.3',
        userAgent: 'jest',
        traceId: 't1',
        payloadDiff: { subAction: 'viewed_360' },
      });
    });

    it('una query secundaria que falle (allSettled) NO bloquea el resto: devuelve [] en esa sección', async () => {
      const { svc, prisma } = build();
      seedFulfilledClient(prisma);
      // Forzamos un fallo en audit (ej. timeout / disconnect).
      prisma.client.auditLog.findMany.mockRejectedValue(new Error('PG timeout audit'));

      const out = await svc.find360(insuredId, scope);
      expect(out.audit).toEqual([]);
      // El resto se mantiene poblado.
      expect(out.coverages.length).toBeGreaterThan(0);
      expect(out.events.length).toBeGreaterThan(0);
      expect(out.certificates.length).toBeGreaterThan(0);
    });

    it('cross-tenant: scope tenant-scoped → SOLO usa client RLS (prisma), nunca bypass', async () => {
      const { svc, prisma, bypass } = build();
      seedFulfilledClient(prisma);
      await svc.find360(insuredId, scope);
      expect(bypass.client.insured.findFirst).not.toHaveBeenCalled();
      expect(prisma.client.insured.findFirst).toHaveBeenCalledTimes(1);
    });

    it('platformAdmin=true: usa bypass client', async () => {
      const { svc, prisma, bypass } = build();
      bypass.client.insured.findFirst.mockResolvedValue(baseInsured as never);
      bypass.client.coverage.findMany.mockResolvedValue([] as never);
      bypass.client.claim.findMany.mockResolvedValue([] as never);
      bypass.client.certificate.findMany.mockResolvedValue([] as never);
      bypass.client.auditLog.findMany.mockResolvedValue([] as never);
      bypass.client.coverageUsage.findMany.mockResolvedValue([] as never);
      bypass.client.user.findMany.mockResolvedValue([] as never);

      await svc.find360(insuredId, { platformAdmin: true, actorId: 'super-1' });
      expect(prisma.client.insured.findFirst).not.toHaveBeenCalled();
      expect(bypass.client.insured.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // S3-09 — Exportación XLSX/PDF.
  // exportRequest debe persistir la fila + encolar SQS + audit.
  // findExport debe filtrar por requestedBy + retornar presigned cuando ready.
  // ---------------------------------------------------------------------------
  describe('exportRequest / findExport', () => {
    const ENV_FAKE: { SQS_QUEUE_REPORTS: string; S3_BUCKET_EXPORTS: string } = {
      SQS_QUEUE_REPORTS: 'http://localhost:4566/000000000000/reports-queue',
      S3_BUCKET_EXPORTS: 'segurasist-dev-exports',
    };
    const actor = { id: 'u1', ip: '127.0.0.1', userAgent: 'jest', traceId: 't1' };

    function buildExport(): {
      svc: InsuredsService;
      prisma: ReturnType<typeof mockPrismaService>;
      sqs: { sendMessage: jest.Mock };
      s3: { getPresignedGetUrl: jest.Mock };
      audit: DeepMockProxy<AuditWriterService>;
    } {
      const prisma = mockPrismaService();
      const bypass = mockDeep<PrismaBypassRlsService>();
      const audit = mockDeep<AuditWriterService>();
      const sqs = { sendMessage: jest.fn().mockResolvedValue('msg-id') };
      const s3 = { getPresignedGetUrl: jest.fn().mockResolvedValue('https://s3.local/signed') };
      const svc = new InsuredsService(prisma, bypass, audit, sqs as never, s3 as never, ENV_FAKE as never);
      // El INSERT pasa por withTenant — devolvemos lo que crea el callback.
      prisma.withTenant.mockImplementation(async (fn: (tx: never) => Promise<unknown>) =>
        fn({ export: { create: jest.fn().mockResolvedValue({}) } } as never),
      );
      return { svc, prisma, sqs, s3, audit };
    }

    it('exportRequest persiste fila + encola SQS + audit', async () => {
      const { svc, sqs, audit } = buildExport();
      const out = await svc.exportRequest('xlsx', { status: 'active' }, tenant, actor);
      expect(out.exportId).toMatch(/^[0-9a-f-]{36}$/);
      expect(out.status).toBe('pending');
      expect(sqs.sendMessage).toHaveBeenCalledTimes(1);
      const [queueUrl, body] = sqs.sendMessage.mock.calls[0]!;
      expect(queueUrl).toBe(ENV_FAKE.SQS_QUEUE_REPORTS);
      expect(body).toMatchObject({ kind: 'export.requested', format: 'xlsx', tenantId: tenant.id });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'export',
          resourceType: 'insureds',
          payloadDiff: expect.objectContaining({ subAction: 'requested', format: 'xlsx' }),
        }),
      );
    });

    it('exportRequest sin SQS injection lanza ForbiddenException', async () => {
      const prisma = mockPrismaService();
      const bypass = mockDeep<PrismaBypassRlsService>();
      const svc = new InsuredsService(prisma, bypass);
      await expect(svc.exportRequest('xlsx', {}, tenant, actor)).rejects.toThrow(
        'Export subsystem not available',
      );
    });

    it('findExport rechaza si requestedBy no matchea (anti-leak inter-operador)', async () => {
      const { svc, prisma } = buildExport();
      prisma.client.export.findFirst.mockResolvedValue(null as never);
      await expect(
        svc.findExport('00000000-0000-0000-0000-000000000099', tenant, { id: 'u-otra' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('findExport con status=ready devuelve downloadUrl + expiresAt 24h', async () => {
      const { svc, prisma, s3 } = buildExport();
      const expId = '11111111-1111-1111-1111-111111111122';
      prisma.client.export.findFirst.mockResolvedValue({
        id: expId,
        tenantId: tenant.id,
        requestedBy: actor.id,
        status: 'ready',
        format: 'xlsx',
        rowCount: 42,
        s3Key: `exports/${tenant.id}/${expId}.xlsx`,
        hash: 'a'.repeat(64),
        error: null,
        requestedAt: new Date('2026-04-25T10:00:00Z'),
        completedAt: new Date('2026-04-25T10:00:08Z'),
      } as never);
      const out = await svc.findExport(expId, tenant, actor);
      expect(out.status).toBe('ready');
      expect(out.downloadUrl).toBe('https://s3.local/signed');
      expect(out.hash).toBe('a'.repeat(64));
      expect(out.rowCount).toBe(42);
      expect(s3.getPresignedGetUrl).toHaveBeenCalledWith(
        ENV_FAKE.S3_BUCKET_EXPORTS,
        `exports/${tenant.id}/${expId}.xlsx`,
        24 * 60 * 60,
      );
      // Expira en ~24h.
      const exp = new Date(out.expiresAt as string).getTime();
      const now = Date.now();
      expect(exp - now).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(exp - now).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
    });

    it('findExport con status=pending NO devuelve downloadUrl', async () => {
      const { svc, prisma, s3 } = buildExport();
      const expId = '11111111-1111-1111-1111-111111111133';
      prisma.client.export.findFirst.mockResolvedValue({
        id: expId,
        tenantId: tenant.id,
        requestedBy: actor.id,
        status: 'pending',
        format: 'pdf',
        rowCount: null,
        s3Key: null,
        hash: null,
        error: null,
        requestedAt: new Date(),
        completedAt: null,
      } as never);
      const out = await svc.findExport(expId, tenant, actor);
      expect(out.status).toBe('pending');
      expect(out.downloadUrl).toBeUndefined();
      expect(s3.getPresignedGetUrl).not.toHaveBeenCalled();
    });

    it('findExport defense-in-depth: rechaza export con tenantId distinto del JWT', async () => {
      const { svc, prisma } = buildExport();
      const expId = '11111111-1111-1111-1111-111111111144';
      // Si por algún bug RLS dejara pasar la fila, el chequeo explícito tiene
      // que cortarla → 404.
      prisma.client.export.findFirst.mockResolvedValue({
        id: expId,
        tenantId: '99999999-9999-9999-9999-999999999999',
        requestedBy: actor.id,
        status: 'pending',
        format: 'xlsx',
        rowCount: null,
        s3Key: null,
        hash: null,
        error: null,
        requestedAt: new Date(),
        completedAt: null,
      } as never);
      await expect(svc.findExport(expId, tenant, actor)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // Sprint 4 — Portal asegurado: findSelf / coveragesForSelf.
  //
  // El RBAC `insured` se enforza por dos razones:
  //   1) RolesGuard a nivel handler (defensa principal).
  //   2) Chequeo explícito en el service (defensa en profundidad / unit-testable).
  //
  // El status se deriva de `validTo` vs hoy: vigente / proxima_a_vencer / vencida.
  // ---------------------------------------------------------------------------
  describe('findSelf', () => {
    const cognitoSub = 'cog-sub-insured-1';
    const insuredUser: AuthUser = {
      id: cognitoSub,
      cognitoSub,
      email: 'asegurado@example.com',
      role: 'insured',
      scopes: [],
      mfaEnrolled: false,
    };

    function buildBaseInsured(overrides: { validTo: Date; brandJson?: unknown }) {
      return {
        id: 'ins-1',
        tenantId: tenant.id,
        cognitoSub,
        fullName: 'Carmen López',
        packageId: 'pkg-1',
        validFrom: new Date('2026-01-01'),
        validTo: overrides.validTo,
        package: { id: 'pkg-1', name: 'Plan Plus' },
        tenant: { brandJson: overrides.brandJson ?? null },
      };
    }

    it('happy path: status=vigente cuando validTo > today + 7d', async () => {
      const { svc, prisma } = build();
      const validTo = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      prisma.client.insured.findFirst.mockResolvedValue(buildBaseInsured({ validTo }) as never);

      const out = await svc.findSelf(insuredUser);

      expect(out.id).toBe('ins-1');
      expect(out.fullName).toBe('Carmen López');
      expect(out.packageName).toBe('Plan Plus');
      expect(out.status).toBe('vigente');
      expect(out.daysUntilExpiry).toBeGreaterThan(7);
      // Sin brandJson.supportPhone → fallback hardcoded MVP.
      expect(out.supportPhone).toBe('+528000000000');
    });

    it('rol distinto de insured → ForbiddenException (defensa en profundidad)', async () => {
      const { svc } = build();
      const adminUser: AuthUser = { ...insuredUser, role: 'admin_segurasist' };
      await expect(svc.findSelf(adminUser)).rejects.toThrow(ForbiddenException);
    });

    it('cognitoSub sin match → NotFoundException (anti-enumeration)', async () => {
      const { svc, prisma } = build();
      prisma.client.insured.findFirst.mockResolvedValue(null);
      await expect(svc.findSelf(insuredUser)).rejects.toThrow(NotFoundException);
    });

    it('status=proxima_a_vencer cuando validTo está entre today y today+7d', async () => {
      const { svc, prisma } = build();
      // validTo = today + 3 días → dentro del threshold de 7d.
      const validTo = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      prisma.client.insured.findFirst.mockResolvedValue(buildBaseInsured({ validTo }) as never);

      const out = await svc.findSelf(insuredUser);
      expect(out.status).toBe('proxima_a_vencer');
      expect(out.daysUntilExpiry).toBeGreaterThanOrEqual(2);
      expect(out.daysUntilExpiry).toBeLessThanOrEqual(3);
    });

    it('status=vencida cuando validTo < today', async () => {
      const { svc, prisma } = build();
      const validTo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      prisma.client.insured.findFirst.mockResolvedValue(buildBaseInsured({ validTo }) as never);

      const out = await svc.findSelf(insuredUser);
      expect(out.status).toBe('vencida');
      expect(out.daysUntilExpiry).toBeLessThan(0);
    });

    it('supportPhone respeta tenant.brandJson.supportPhone si existe', async () => {
      const { svc, prisma } = build();
      const validTo = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      prisma.client.insured.findFirst.mockResolvedValue(
        buildBaseInsured({ validTo, brandJson: { supportPhone: '+525511112222' } }) as never,
      );

      const out = await svc.findSelf(insuredUser);
      expect(out.supportPhone).toBe('+525511112222');
    });
  });

  describe('coveragesForSelf', () => {
    const cognitoSub = 'cog-sub-insured-2';
    const insuredUser: AuthUser = {
      id: cognitoSub,
      cognitoSub,
      email: 'asegurado2@example.com',
      role: 'insured',
      scopes: [],
      mfaEnrolled: false,
    };

    function seedSelf(prisma: ReturnType<typeof mockPrismaService>) {
      prisma.client.insured.findFirst.mockResolvedValue({
        id: 'ins-2',
        tenantId: tenant.id,
        cognitoSub,
        fullName: 'Juan Pérez',
        packageId: 'pkg-2',
        validFrom: new Date('2026-01-01'),
        validTo: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        package: { id: 'pkg-2', name: 'Plan Básico' },
        tenant: { brandJson: null },
      } as never);
    }

    it('agrega usage por cobertura (count + amount) y mappea unit', async () => {
      const { svc, prisma } = build();
      seedSelf(prisma);
      prisma.client.coverage.findMany.mockResolvedValue([
        {
          id: 'cov-count',
          name: 'Consultas',
          packageId: 'pkg-2',
          limitCount: 12,
          limitAmount: null,
        },
        {
          id: 'cov-amount',
          name: 'Estudios',
          packageId: 'pkg-2',
          limitCount: null,
          limitAmount: '5000.00',
        },
      ] as never);
      const lastUsedAt = new Date('2026-04-20T10:00:00Z');
      prisma.client.coverageUsage.aggregate
        .mockResolvedValueOnce({
          _sum: { amount: null },
          _count: { id: 3 },
          _max: { usedAt: lastUsedAt },
        } as never)
        .mockResolvedValueOnce({
          _sum: { amount: '750.50' },
          _count: { id: 2 },
          _max: { usedAt: lastUsedAt },
        } as never);

      const out = await svc.coveragesForSelf(insuredUser);

      expect(out).toHaveLength(2);
      const count = out.find((c) => c.id === 'cov-count');
      expect(count?.type).toBe('count');
      expect(count?.limit).toBe(12);
      expect(count?.used).toBe(3);
      expect(count?.unit).toBe('eventos');
      expect(count?.lastUsedAt).toBe(lastUsedAt.toISOString());

      const amount = out.find((c) => c.id === 'cov-amount');
      expect(amount?.type).toBe('amount');
      expect(amount?.limit).toBe(5000);
      expect(amount?.used).toBeCloseTo(750.5);
      expect(amount?.unit).toBe('MXN');
    });

    it('rol distinto de insured → ForbiddenException (heredado de findSelf)', async () => {
      const { svc } = build();
      const adminUser: AuthUser = { ...insuredUser, role: 'operator' };
      await expect(svc.coveragesForSelf(adminUser)).rejects.toThrow(ForbiddenException);
    });
  });
});
