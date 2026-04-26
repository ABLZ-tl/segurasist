/**
 * Unit tests del EmailWorkerService (mock SES + S3 + Prisma).
 */
import type { PrismaBypassRlsService } from '../../../../src/common/prisma/prisma-bypass-rls.service';
import type { Env } from '../../../../src/config/env.schema';
import type { S3Service } from '../../../../src/infra/aws/s3.service';
import type { SesService } from '../../../../src/infra/aws/ses.service';
import { EmailWorkerService } from '../../../../src/workers/email-worker.service';

function makeEnv(): Env {
  return {
    NODE_ENV: 'test',
    AWS_REGION: 'us-east-1',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
    S3_BUCKET_CERTIFICATES: 'b',
    SQS_QUEUE_EMAIL: 'http://q/email',
    SES_SENDER_DOMAIN: 'mac.local',
    SES_CONFIGURATION_SET: 'cs',
    EMAIL_FROM_CERT: 'cert@x.com',
    CERT_BASE_URL: 'http://localhost:3000',
  } as Env;
}

interface MockClient {
  certificate: { findFirst: jest.Mock };
  insured: { findFirst: jest.Mock };
  tenant: { findFirst: jest.Mock };
  emailEvent: { create: jest.Mock };
}

function makeMocks() {
  const client: MockClient = {
    certificate: { findFirst: jest.fn() },
    insured: { findFirst: jest.fn() },
    tenant: { findFirst: jest.fn() },
    emailEvent: {
      create: jest.fn().mockImplementation(async (args: unknown) => ({
        id: 'evt-1',
        ...((args as { data: unknown }).data as object),
      })),
    },
  };
  const prismaBypass = { client } as unknown as PrismaBypassRlsService;
  const s3 = {
    getPresignedGetUrl: jest.fn().mockResolvedValue('https://s3/presigned'),
  } as unknown as S3Service;
  const ses = {
    send: jest.fn().mockResolvedValue({ messageId: 'mid-1', transport: 'smtp' }),
  } as unknown as SesService;
  return { client, prismaBypass, s3, ses };
}

describe('EmailWorkerService', () => {
  it('certificate.issued → genera URL S3, persist queued+sent, llama ses.send', async () => {
    const { client, prismaBypass, s3, ses } = makeMocks();
    const tenantId = '11111111-1111-1111-1111-111111111111';
    client.certificate.findFirst.mockResolvedValue({
      id: 'c1',
      tenantId,
      insuredId: 'i1',
      s3Key: 'certificates/x/y/v1.pdf',
      hash: 'h',
    });
    client.insured.findFirst.mockResolvedValue({
      id: 'i1',
      email: 'juan@example.com',
      fullName: 'Juan',
      validTo: new Date('2026-12-31'),
      package: { name: 'Plan' },
    });
    client.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'MAC', brandJson: null });

    const worker = new EmailWorkerService(prismaBypass, s3, ses, makeEnv());
    const r = await worker.handleIssued({
      kind: 'certificate.issued',
      tenantId,
      certificateId: 'c1',
      insuredId: 'i1',
      version: 1,
      s3Key: 'certificates/x/y/v1.pdf',
      hash: 'h',
      verificationUrl: 'http://x',
      occurredAt: new Date().toISOString(),
    });

    expect(r.sent).toBe(true);
    expect(s3.getPresignedGetUrl).toHaveBeenCalledWith('b', 'certificates/x/y/v1.pdf', 7 * 24 * 60 * 60);
    expect(ses.send).toHaveBeenCalled();
    const sendArgs = (ses.send as jest.Mock).mock.calls[0][0];
    expect(sendArgs.to).toBe('juan@example.com');
    expect(sendArgs.from).toBe('cert@x.com');
    expect(sendArgs.html).toContain('Juan');
    expect(sendArgs.html).toContain('https://s3/presigned');
    expect(sendArgs.tags?.cert).toBe('c1');
    expect(sendArgs.headers?.['X-Trace-Id']).toBeDefined();
    // Persistencia: queued + sent
    const types = client.emailEvent.create.mock.calls.map(
      (c) => (c[0].data as { eventType: string }).eventType,
    );
    expect(types).toContain('queued');
    expect(types).toContain('sent');
  });

  it('insured sin email → skip + persist event_type=rejected', async () => {
    const { client, prismaBypass, s3, ses } = makeMocks();
    client.certificate.findFirst.mockResolvedValue({
      id: 'c1',
      tenantId: 't',
      insuredId: 'i1',
      s3Key: 'k',
      hash: 'h',
    });
    client.insured.findFirst.mockResolvedValue({
      id: 'i1',
      email: null,
      fullName: 'X',
      validTo: new Date(),
      package: { name: 'P' },
    });
    client.tenant.findFirst.mockResolvedValue({ id: 't', name: 'T', brandJson: null });

    const worker = new EmailWorkerService(prismaBypass, s3, ses, makeEnv());
    const r = await worker.handleIssued({
      kind: 'certificate.issued',
      tenantId: 't',
      certificateId: 'c1',
      insuredId: 'i1',
      version: 1,
      s3Key: 'k',
      hash: 'h',
      verificationUrl: 'http://x',
      occurredAt: new Date().toISOString(),
    });

    expect(r.sent).toBe(false);
    expect(r.skipped).toBe('no_email');
    expect(ses.send).not.toHaveBeenCalled();
    const data = client.emailEvent.create.mock.calls[0][0].data;
    expect(data.eventType).toBe('rejected');
    expect((data.detail as { reason: string }).reason).toBe('skipped_no_email');
  });

  it('overrideTo (resend) gana sobre insured.email', async () => {
    const { client, prismaBypass, s3, ses } = makeMocks();
    client.certificate.findFirst.mockResolvedValue({
      id: 'c1',
      tenantId: 't',
      insuredId: 'i1',
      s3Key: 'k',
      hash: 'h',
    });
    client.insured.findFirst.mockResolvedValue({
      id: 'i1',
      email: 'original@x.com',
      fullName: 'X',
      validTo: new Date(),
      package: { name: 'P' },
    });
    client.tenant.findFirst.mockResolvedValue({ id: 't', name: 'T', brandJson: null });

    const worker = new EmailWorkerService(prismaBypass, s3, ses, makeEnv());
    await worker.handleIssued({
      kind: 'certificate.issued',
      tenantId: 't',
      certificateId: 'c1',
      insuredId: 'i1',
      version: 1,
      s3Key: 'k',
      hash: 'h',
      verificationUrl: 'http://x',
      occurredAt: new Date().toISOString(),
      overrideTo: 'override@x.com',
    });
    expect((ses.send as jest.Mock).mock.calls[0][0].to).toBe('override@x.com');
  });

  it('SES falla → persiste evento rejected con reason send_failed', async () => {
    const { client, prismaBypass, s3, ses } = makeMocks();
    (ses.send as jest.Mock).mockRejectedValueOnce(new Error('SES boom'));
    client.certificate.findFirst.mockResolvedValue({
      id: 'c1',
      tenantId: 't',
      insuredId: 'i1',
      s3Key: 'k',
      hash: 'h',
    });
    client.insured.findFirst.mockResolvedValue({
      id: 'i1',
      email: 'a@b.com',
      fullName: 'X',
      validTo: new Date(),
      package: { name: 'P' },
    });
    client.tenant.findFirst.mockResolvedValue({ id: 't', name: 'T', brandJson: null });

    const worker = new EmailWorkerService(prismaBypass, s3, ses, makeEnv());
    const r = await worker.handleIssued({
      kind: 'certificate.issued',
      tenantId: 't',
      certificateId: 'c1',
      insuredId: 'i1',
      version: 1,
      s3Key: 'k',
      hash: 'h',
      verificationUrl: 'http://x',
      occurredAt: new Date().toISOString(),
    });
    expect(r.sent).toBe(false);
    const lastCall = client.emailEvent.create.mock.calls.pop();
    expect(lastCall[0].data.eventType).toBe('rejected');
    expect(lastCall[0].data.detail.reason).toBe('send_failed');
  });

  it('cert no existe → no llama SES y devuelve sent:false', async () => {
    const { client, prismaBypass, s3, ses } = makeMocks();
    client.certificate.findFirst.mockResolvedValue(null);
    const worker = new EmailWorkerService(prismaBypass, s3, ses, makeEnv());
    const r = await worker.handleIssued({
      kind: 'certificate.issued',
      tenantId: 't',
      certificateId: 'cX',
      insuredId: 'i1',
      version: 1,
      s3Key: 'k',
      hash: 'h',
      verificationUrl: 'http://x',
      occurredAt: new Date().toISOString(),
    });
    expect(r.sent).toBe(false);
    expect(ses.send).not.toHaveBeenCalled();
  });

  it('tenant.brandJson.emailFrom override gana sobre EMAIL_FROM_CERT', async () => {
    const { client, prismaBypass, s3, ses } = makeMocks();
    client.certificate.findFirst.mockResolvedValue({
      id: 'c1',
      tenantId: 't',
      insuredId: 'i1',
      s3Key: 'k',
      hash: 'h',
    });
    client.insured.findFirst.mockResolvedValue({
      id: 'i1',
      email: 'a@b.com',
      fullName: 'X',
      validTo: new Date(),
      package: { name: 'P' },
    });
    client.tenant.findFirst.mockResolvedValue({
      id: 't',
      name: 'T',
      brandJson: { emailFrom: 'no-reply@mac.com' },
    });
    const worker = new EmailWorkerService(prismaBypass, s3, ses, makeEnv());
    await worker.handleIssued({
      kind: 'certificate.issued',
      tenantId: 't',
      certificateId: 'c1',
      insuredId: 'i1',
      version: 1,
      s3Key: 'k',
      hash: 'h',
      verificationUrl: 'http://x',
      occurredAt: new Date().toISOString(),
    });
    expect((ses.send as jest.Mock).mock.calls[0][0].from).toBe('no-reply@mac.com');
  });
});
