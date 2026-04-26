/**
 * Unit test del endpoint público de verificación.
 *
 * Solo testea la lógica del service (`CertificatesService.verify`); el
 * rate limiting y el guard `@Public()` los cubren los e2e.
 */
import type { PrismaBypassRlsService } from '../../../../src/common/prisma/prisma-bypass-rls.service';
import type { PrismaService } from '../../../../src/common/prisma/prisma.service';
import type { Env } from '../../../../src/config/env.schema';
import type { S3Service } from '../../../../src/infra/aws/s3.service';
import type { SqsService } from '../../../../src/infra/aws/sqs.service';
import { CertificatesService } from '../../../../src/modules/certificates/certificates.service';

function makeService() {
  const bypassClient = {
    certificate: { findFirst: jest.fn() },
    insured: { findFirst: jest.fn() },
    tenant: { findFirst: jest.fn() },
  };
  const prismaBypass = { client: bypassClient } as unknown as PrismaBypassRlsService;
  const prisma = {
    client: {
      certificate: { findFirst: jest.fn() },
    },
  } as unknown as PrismaService;
  const env = { CERT_BASE_URL: 'http://localhost:3000', S3_BUCKET_CERTIFICATES: 'b' } as Env;
  const svc = new CertificatesService(prisma, prismaBypass, {} as S3Service, {} as SqsService, env);
  return { svc, bypassClient };
}

describe('CertificatesService.verify (endpoint público)', () => {
  it('hash con formato inválido → valid:false sin tocar BD', async () => {
    const { svc, bypassClient } = makeService();
    const out = await svc.verify('not-a-hash');
    expect(out.valid).toBe(false);
    expect(bypassClient.certificate.findFirst).not.toHaveBeenCalled();
  });

  it('hash válido pero sin cert en BD → valid:false', async () => {
    const { svc, bypassClient } = makeService();
    bypassClient.certificate.findFirst.mockResolvedValue(null);
    const out = await svc.verify('a'.repeat(64));
    expect(out.valid).toBe(false);
  });

  it('hash matchea cert issued → datos no-PII', async () => {
    const { svc, bypassClient } = makeService();
    const tenantId = '11111111-1111-1111-1111-111111111111';
    bypassClient.certificate.findFirst.mockResolvedValue({
      validTo: new Date('2026-12-31'),
      issuedAt: new Date('2026-04-25'),
      tenantId,
      insuredId: 'i1',
    });
    bypassClient.insured.findFirst.mockResolvedValue({
      fullName: 'Juan Pérez',
      validFrom: new Date('2026-01-01'),
      package: { name: 'Plan Plata' },
    });
    bypassClient.tenant.findFirst.mockResolvedValue({ name: 'MAC' });

    const out = await svc.verify('a'.repeat(64));
    expect(out.valid).toBe(true);
    expect(out.insured?.fullName).toBe('Juan Pérez');
    expect(out.insured?.packageName).toBe('Plan Plata');
    expect(out.tenantName).toBe('MAC');
    // No-PII: NO debe exponer CURP, RFC, email, teléfono.
    expect(JSON.stringify(out)).not.toMatch(/curp|rfc|email|phone/i);
  });

  it('cert revoked → valid:false (verify sólo devuelve issued)', async () => {
    const { svc, bypassClient } = makeService();
    bypassClient.certificate.findFirst.mockResolvedValue(null);
    const out = await svc.verify('b'.repeat(64));
    expect(out.valid).toBe(false);
  });

  it('hash hex pero longitud incorrecta → valid:false', async () => {
    const { svc } = makeService();
    const out = await svc.verify('a'.repeat(63));
    expect(out.valid).toBe(false);
  });
});
