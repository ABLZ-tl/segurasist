import type { AuthUser } from '@common/decorators/current-user.decorator';
import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import type { Env } from '@config/env.schema';
import type { S3Service } from '@infra/aws/s3.service';
import type { SqsService } from '@infra/aws/sqs.service';
import type { AuditWriterService } from '@modules/audit/audit-writer.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import { CertificatesService } from './certificates.service';

/**
 * Sprint 4 — Portal asegurado: `urlForSelf`.
 *
 * Tests aislados de Nest container — instanciamos el service manual con
 * mocks puros (per CONVENCIONES OBLIGATORIAS DE TESTS). El RBAC se enforza
 * a nivel service (defensa en profundidad) además del RolesGuard.
 */
describe('CertificatesService.urlForSelf', () => {
  const ENV_FAKE = {
    S3_BUCKET_CERTIFICATES: 'segurasist-dev-certificates',
  } as unknown as Env;

  const cognitoSub = 'cog-sub-insured-cert';
  const insuredUser: AuthUser = {
    id: cognitoSub,
    cognitoSub,
    email: 'asegurado@example.com',
    role: 'insured',
    scopes: [],
    mfaEnrolled: false,
  };

  function build(): {
    svc: CertificatesService;
    prisma: ReturnType<typeof mockPrismaService>;
    bypass: DeepMockProxy<PrismaBypassRlsService>;
    s3: DeepMockProxy<S3Service>;
    sqs: DeepMockProxy<SqsService>;
    audit: DeepMockProxy<AuditWriterService>;
  } {
    const prisma = mockPrismaService();
    const bypass = mockDeep<PrismaBypassRlsService>();
    const s3 = mockDeep<S3Service>();
    const sqs = mockDeep<SqsService>();
    const audit = mockDeep<AuditWriterService>();
    s3.getPresignedGetUrl.mockResolvedValue('https://test.url/xyz');
    audit.record.mockResolvedValue();
    const svc = new CertificatesService(prisma, bypass, s3, sqs, ENV_FAKE, audit);
    return { svc, prisma, bypass, s3, sqs, audit };
  }

  it('happy path: encuentra cert, genera presigned URL TTL 7d, persiste audit', async () => {
    const { svc, prisma, s3, audit } = build();
    prisma.client.insured.findFirst.mockResolvedValue({
      id: 'ins-cert-1',
      tenantId: 't-1',
    } as never);
    const issuedAt = new Date('2026-04-01T10:00:00Z');
    const validTo = new Date('2027-01-01');
    prisma.client.certificate.findFirst.mockResolvedValue({
      id: 'cert-1',
      version: 2,
      s3Key: 'certificates/t-1/ins-cert-1/v2.pdf',
      issuedAt,
      validTo,
    } as never);

    const out = await svc.urlForSelf(insuredUser, { ip: '10.0.0.1', userAgent: 'jest', traceId: 't1' });

    expect(out.url).toBe('https://test.url/xyz');
    expect(out.certificateId).toBe('cert-1');
    expect(out.version).toBe(2);
    expect(out.issuedAt).toBe(issuedAt.toISOString());
    expect(out.validTo).toBe('2027-01-01');
    // TTL 7 días.
    const expDelta = new Date(out.expiresAt).getTime() - Date.now();
    expect(expDelta).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(expDelta).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 1000);

    expect(s3.getPresignedGetUrl).toHaveBeenCalledWith(
      'segurasist-dev-certificates',
      'certificates/t-1/ins-cert-1/v2.pdf',
      7 * 24 * 60 * 60,
    );
    // Audit log obligatorio (F6 iter 2 H-01: action='read_downloaded' del enum
    // extendido reemplaza el overload payloadDiff.subAction='downloaded').
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't-1',
        actorId: cognitoSub,
        action: 'read_downloaded',
        resourceType: 'certificates',
        resourceId: 'cert-1',
        ip: '10.0.0.1',
        userAgent: 'jest',
        traceId: 't1',
      }),
    );
    const auditCall = (audit.record as jest.Mock).mock.calls[0]?.[0];
    expect((auditCall as { payloadDiff?: unknown }).payloadDiff).toBeUndefined();
  });

  it('sin cert emitido → NotFoundException con mensaje user-friendly', async () => {
    const { svc, prisma, audit } = build();
    prisma.client.insured.findFirst.mockResolvedValue({
      id: 'ins-cert-2',
      tenantId: 't-1',
    } as never);
    prisma.client.certificate.findFirst.mockResolvedValue(null);

    await expect(svc.urlForSelf(insuredUser)).rejects.toThrow(NotFoundException);
    // No audit (no hay cert al que ligar).
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rol distinto de insured → ForbiddenException (defensa en profundidad)', async () => {
    const { svc } = build();
    const adminUser: AuthUser = { ...insuredUser, role: 'admin_segurasist' };
    await expect(svc.urlForSelf(adminUser)).rejects.toThrow(ForbiddenException);
  });
});
