/**
 * S3-06 — Integration test de la vista 360 del asegurado.
 *
 * NO levanta Postgres real (ese path lo cubre `e2e/insured-360.e2e-spec.ts`
 * cuando la BD está disponible). Aquí mockeamos `PrismaService` con
 * `mockPrismaService()` y validamos que el `InsuredsService.find360` arme
 * correctamente las 5 secciones a partir de fixtures realistas — el contrato
 * de salida coincide con el shape `Insured360` que consume el FE.
 *
 * Cobertura:
 *   1. Insured con package + 2 coverages + 1 claim + 1 cert + 3 audit rows
 *      → todas las secciones pobladas con counts esperados.
 *   2. AuditWriter recibe `record({action:'read_viewed', ...})` — F6 iter 2:
 *      enum AuditAction extendido reemplaza el overload payloadDiff.subAction.
 *   3. Una sección que falle (timeout) NO derriba la respuesta — empty array.
 */
import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import type { AuditWriterService } from '@modules/audit/audit-writer.service';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { InsuredsService, type InsuredsScope } from '../../src/modules/insureds/insureds.service';
import { mockPrismaService } from '../mocks/prisma.mock';

const TENANT = '11111111-1111-1111-1111-111111111111';
const INSURED = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const PACKAGE = 'pppppppp-pppp-pppp-pppp-pppppppppppp';
const NOW = new Date('2026-04-25T12:00:00Z');

const scope: InsuredsScope = { platformAdmin: false, tenantId: TENANT, actorId: 'u-actor' };

function buildSvc(): {
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

function seedHappyPath(prisma: ReturnType<typeof mockPrismaService>) {
  prisma.client.insured.findFirst.mockResolvedValue({
    id: INSURED,
    tenantId: TENANT,
    curp: 'AAAA800101HDFRRR01',
    rfc: 'AAAA800101AAA',
    fullName: 'Carmen López',
    dob: new Date('1980-01-01'),
    email: 'carmen@example.com',
    phone: '+525555555555',
    packageId: PACKAGE,
    validFrom: new Date('2026-01-01'),
    validTo: new Date('2027-01-01'),
    status: 'active',
    metadata: { entidad: 'CDMX', numeroEmpleadoExterno: 'EMP-99' },
    createdAt: NOW,
    updatedAt: NOW,
    package: { id: PACKAGE, name: 'Plan Plus' },
    beneficiaries: [{ id: 'b1', fullName: 'Hijo López', dob: new Date('2010-05-10'), relationship: 'child' }],
  } as never);
  prisma.client.coverage.findMany.mockResolvedValue([
    {
      id: 'cov1',
      packageId: PACKAGE,
      name: 'Consultas',
      type: 'consultation',
      limitCount: 12,
      limitAmount: null,
      createdAt: NOW,
    },
    {
      id: 'cov2',
      packageId: PACKAGE,
      name: 'Estudios',
      type: 'laboratory',
      limitCount: null,
      limitAmount: '5000.00',
      createdAt: NOW,
    },
  ] as never);
  prisma.client.claim.findMany.mockResolvedValue([
    {
      id: 'cl1',
      insuredId: INSURED,
      type: 'consultation',
      reportedAt: NOW,
      description: 'Consulta general',
      status: 'reported',
      amountEstimated: '1200.00',
    },
  ] as never);
  prisma.client.certificate.findMany.mockResolvedValue([
    {
      id: 'cert1',
      insuredId: INSURED,
      version: 1,
      issuedAt: NOW,
      validTo: new Date('2027-01-01'),
      status: 'issued',
      hash: 'h1',
      qrPayload: 'qr1',
    },
  ] as never);
  prisma.client.auditLog.findMany.mockResolvedValue([
    {
      id: 'au1',
      action: 'read',
      actorId: 'u-actor',
      resourceType: 'insureds',
      resourceId: INSURED,
      ip: '10.0.0.1',
      occurredAt: NOW,
      payloadDiff: { subAction: 'viewed_360' },
    },
    {
      id: 'au2',
      action: 'update',
      actorId: 'u-actor',
      resourceType: 'insureds',
      resourceId: INSURED,
      ip: '10.0.0.1',
      occurredAt: new Date(NOW.getTime() - 3600_000),
      payloadDiff: { body: { fullName: 'X' } },
    },
    {
      id: 'au3',
      action: 'read',
      actorId: null,
      resourceType: 'insureds',
      resourceId: INSURED,
      ip: '10.0.0.2',
      occurredAt: new Date(NOW.getTime() - 7200_000),
      payloadDiff: null,
    },
  ] as never);
  prisma.client.coverageUsage.findMany.mockResolvedValue([
    { id: 'u1', insuredId: INSURED, coverageId: 'cov1', usedAt: NOW, amount: null },
  ] as never);
  prisma.client.user.findMany.mockResolvedValue([{ id: 'u-actor', email: 'op@mac.local' }] as never);
}

describe('Insured 360 — integration shape', () => {
  it('arma las 5 secciones con counts y hidrata actor.email', async () => {
    const { svc, prisma } = buildSvc();
    seedHappyPath(prisma);
    const out = await svc.find360(INSURED, scope);

    expect(out.insured.fullName).toBe('Carmen López');
    expect(out.insured.entidad).toBe('CDMX');
    expect(out.insured.numeroEmpleadoExterno).toBe('EMP-99');
    expect(out.coverages).toHaveLength(2);
    expect(out.events).toHaveLength(1);
    expect(out.certificates).toHaveLength(1);
    expect(out.audit).toHaveLength(3);
    // Actor con id → email hidratado; null → string vacío.
    expect(out.audit[0]?.actorEmail).toBe('op@mac.local');
    expect(out.audit[2]?.actorEmail).toBe('');
    // limit_count consume contadores; limit_amount consume mxn.
    const cov1 = out.coverages.find((c) => c.id === 'cov1');
    expect(cov1?.limit).toBe(12);
    expect(cov1?.used).toBe(1);
  });

  it('persiste audit_log via AuditWriter con shape esperado (F6 iter 2: read_viewed)', async () => {
    const { svc, prisma, audit } = buildSvc();
    seedHappyPath(prisma);
    await svc.find360(INSURED, scope, { ip: '189.99.99.99', userAgent: 'jest-int', traceId: 'tr-1' });
    expect(audit.record).toHaveBeenCalledTimes(1);
    // F6 iter 2 H-01: action='read_viewed' (enum extendido) reemplaza el
    // overload payloadDiff.subAction='viewed_360'.
    expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
      tenantId: TENANT,
      action: 'read_viewed',
      resourceType: 'insureds',
      resourceId: INSURED,
      ip: '189.99.99.99',
      userAgent: 'jest-int',
      traceId: 'tr-1',
    });
  });

  it('si una query secundaria falla (allSettled), la sección queda en [] sin tirar 500', async () => {
    const { svc, prisma } = buildSvc();
    seedHappyPath(prisma);
    prisma.client.certificate.findMany.mockRejectedValue(new Error('deadlock'));
    const out = await svc.find360(INSURED, scope);
    expect(out.certificates).toEqual([]);
    expect(out.coverages.length).toBe(2);
    expect(out.events.length).toBe(1);
  });
});
