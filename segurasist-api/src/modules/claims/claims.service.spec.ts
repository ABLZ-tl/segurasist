import type { AuthUser } from '@common/decorators/current-user.decorator';
import type { AuditWriterService } from '@modules/audit/audit-writer.service';
import { ForbiddenException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import { ClaimsService } from './claims.service';
import { CreateClaimSelfSchema, type CreateClaimSelfDto } from './dto/claim.dto';

/**
 * Sprint 4 — Portal asegurado: `createForSelf` + Zod schema validation.
 *
 * Tests aislados: instanciamos el service con mocks puros (Prisma + Audit).
 * El zod schema lo validamos por separado (el pipe es responsabilidad del
 * controller; el service recibe ya el DTO parseado).
 */
describe('ClaimsService.createForSelf', () => {
  const cognitoSub = 'cog-sub-claim-1';
  const insuredUser: AuthUser = {
    id: cognitoSub,
    cognitoSub,
    email: 'asegurado@example.com',
    role: 'insured',
    scopes: [],
    mfaEnrolled: false,
  };

  function build(): {
    svc: ClaimsService;
    prisma: ReturnType<typeof mockPrismaService>;
    audit: DeepMockProxy<AuditWriterService>;
  } {
    const prisma = mockPrismaService();
    const audit = mockDeep<AuditWriterService>();
    audit.record.mockResolvedValue();
    const svc = new ClaimsService(prisma, audit);
    return { svc, prisma, audit };
  }

  const validDto: CreateClaimSelfDto = {
    type: 'medical',
    occurredAt: '2026-04-20',
    description: 'Consulta de rutina por dolor de cabeza',
  };

  it('happy path: persiste claim + audit + devuelve ticket short', async () => {
    const { svc, prisma, audit } = build();
    prisma.client.insured.findFirst.mockResolvedValue({
      id: 'ins-1',
      tenantId: 't-1',
    } as never);
    const reportedAt = new Date('2026-04-25T12:00:00Z');
    prisma.client.claim.create.mockResolvedValue({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      reportedAt,
      status: 'reported',
    } as never);

    const out = await svc.createForSelf(insuredUser, validDto);

    expect(out.id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(out.status).toBe('reported');
    expect(out.ticketNumber).toBe('CL-AAAAAAAA');
    expect(out.reportedAt).toBe(reportedAt.toISOString());

    // INSERT mappea medical → consultation y persiste type user-facing en metadata.
    const createCall = prisma.client.claim.create.mock.calls[0]?.[0];
    expect(createCall?.data).toMatchObject({
      tenantId: 't-1',
      insuredId: 'ins-1',
      type: 'consultation',
      status: 'reported',
      description: validDto.description,
      metadata: { portalType: 'medical', occurredAt: '2026-04-20' },
    });

    // Audit log claim.reported.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't-1',
        actorId: cognitoSub,
        action: 'create',
        resourceType: 'claims',
        resourceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        payloadDiff: expect.objectContaining({ subAction: 'reported', type: 'medical' }),
      }),
    );
  });

  it('rol distinto de insured → ForbiddenException', async () => {
    const { svc, prisma } = build();
    const opUser: AuthUser = { ...insuredUser, role: 'operator' };
    await expect(svc.createForSelf(opUser, validDto)).rejects.toThrow(ForbiddenException);
    // No INSERT.
    expect(prisma.client.claim.create).not.toHaveBeenCalled();
  });

  it('zod schema rechaza description < 10 chars (validación pre-pipe)', () => {
    const parsed = CreateClaimSelfSchema.safeParse({
      type: 'medical',
      occurredAt: '2026-04-20',
      description: 'corta',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toContain('description');
    }
  });

  it('zod schema rechaza occurredAt futuro (>today)', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const parsed = CreateClaimSelfSchema.safeParse({
      type: 'medical',
      occurredAt: future,
      description: 'Descripción válida con suficientes caracteres.',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toContain('occurredAt');
    }
  });
});
