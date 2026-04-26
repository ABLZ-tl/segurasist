/**
 * Unit tests del PdfWorkerService — mock Puppeteer/S3/SQS/Prisma.
 */
import type { PrismaBypassRlsService } from '../../../../src/common/prisma/prisma-bypass-rls.service';
import type { Env } from '../../../../src/config/env.schema';
import type { S3Service } from '../../../../src/infra/aws/s3.service';
import type { SqsService } from '../../../../src/infra/aws/sqs.service';
import type { PuppeteerService } from '../../../../src/modules/certificates/puppeteer.service';
import { PdfWorkerService } from '../../../../src/workers/pdf-worker.service';

function makeEnv(): Env {
  return {
    NODE_ENV: 'test',
    AWS_REGION: 'us-east-1',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
    S3_BUCKET_CERTIFICATES: 'certs-bucket',
    KMS_KEY_ID: 'alias/test',
    SQS_QUEUE_PDF: 'http://q/pdf',
    SQS_QUEUE_EMAIL: 'http://q/email',
    CERT_BASE_URL: 'http://localhost:3000',
    EMAIL_FROM_CERT: 'cert@x.com',
  } as Env;
}

interface MockClient {
  insured: { findFirst: jest.Mock };
  package: { findFirst: jest.Mock };
  tenant: { findFirst: jest.Mock };
  certificate: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makeMocks() {
  const mockClient: MockClient = {
    insured: { findFirst: jest.fn() },
    package: { findFirst: jest.fn() },
    tenant: { findFirst: jest.fn() },
    certificate: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (tx: MockClient) => Promise<unknown>) => fn(mockClient)),
  };
  const prismaBypass = { client: mockClient } as unknown as PrismaBypassRlsService;
  const s3 = { putObject: jest.fn().mockResolvedValue(undefined) } as unknown as S3Service;
  const sqs = { sendMessage: jest.fn().mockResolvedValue('msg-1') } as unknown as SqsService;
  const puppeteer = {
    renderPdf: jest.fn().mockResolvedValue({ pdf: Buffer.from('%PDF-1.4 ok'), durationMs: 100 }),
  } as unknown as PuppeteerService;
  return { mockClient, prismaBypass, s3, sqs, puppeteer };
}

describe('PdfWorkerService', () => {
  it('handleEvent insured.created → genera cert v1, sube a S3 SSE-KMS, persiste, emite issued', async () => {
    const { mockClient, prismaBypass, s3, sqs, puppeteer } = makeMocks();
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const insuredId = '22222222-2222-2222-2222-222222222222';
    const packageId = '33333333-3333-3333-3333-333333333333';

    mockClient.insured.findFirst.mockResolvedValue({
      id: insuredId,
      tenantId,
      packageId,
      fullName: 'Juan Pérez',
      curp: 'JUAN850101HMNXXX01',
      email: 'juan@example.com',
      validFrom: new Date('2026-01-01'),
      validTo: new Date('2026-12-31'),
      package: {
        id: packageId,
        name: 'Plan Plata',
        coverages: [],
      },
    });
    mockClient.tenant.findFirst.mockResolvedValue({
      id: tenantId,
      name: 'MAC',
      slug: 'mac',
      brandJson: null,
    });
    mockClient.package.findFirst.mockResolvedValue({
      id: packageId,
      name: 'Plan Plata',
      coverages: [],
    });
    mockClient.certificate.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'cert-1',
      ...args.data,
    }));

    const worker = new PdfWorkerService(prismaBypass, s3, sqs, puppeteer, makeEnv());
    const result = await worker.handleEvent({
      kind: 'insured.created',
      tenantId,
      insuredId,
      packageId,
      source: { batchId: 'b1', rowNumber: 1 },
      occurredAt: new Date().toISOString(),
    });

    expect(result.certificateId).toBe('cert-1');
    expect(puppeteer.renderPdf).toHaveBeenCalledTimes(1);
    expect(s3.putObject).toHaveBeenCalledTimes(1);
    const putCall = (s3.putObject as jest.Mock).mock.calls[0][0];
    expect(putCall.ServerSideEncryption).toBe('aws:kms');
    expect(putCall.SSEKMSKeyId).toBe('alias/test');
    expect(putCall.Bucket).toBe('certs-bucket');
    expect(putCall.Key).toContain(`certificates/${tenantId}/${insuredId}/v1.pdf`);
    expect(putCall.Body).toBeInstanceOf(Buffer);

    expect(mockClient.certificate.create).toHaveBeenCalled();
    const certData = mockClient.certificate.create.mock.calls[0][0].data;
    expect(certData.version).toBe(1);
    expect(certData.status).toBe('issued');

    expect(sqs.sendMessage).toHaveBeenCalled();
    const msgArgs = (sqs.sendMessage as jest.Mock).mock.calls[0];
    expect(msgArgs[0]).toBe('http://q/email');
    expect((msgArgs[1] as { kind: string }).kind).toBe('certificate.issued');
  });

  it('handleEvent reissue → marca cert anterior reissued y crea v+1', async () => {
    const { mockClient, prismaBypass, s3, sqs, puppeteer } = makeMocks();
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const oldCertId = 'cert-old';
    mockClient.certificate.findFirst.mockResolvedValue({
      id: oldCertId,
      tenantId,
      insuredId: 'i1',
      version: 2,
      status: 'issued',
    });
    mockClient.insured.findFirst.mockResolvedValue({
      id: 'i1',
      tenantId,
      packageId: 'p1',
      fullName: 'Y',
      curp: 'CURP',
      validFrom: new Date('2026-01-01'),
      validTo: new Date('2026-12-31'),
    });
    mockClient.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'T', slug: 'mac', brandJson: null });
    mockClient.package.findFirst.mockResolvedValue({ id: 'p1', name: 'Plan', coverages: [] });
    mockClient.certificate.create.mockResolvedValue({ id: 'cert-new' });

    const worker = new PdfWorkerService(prismaBypass, s3, sqs, puppeteer, makeEnv());
    const r = await worker.handleEvent({
      kind: 'certificate.reissue_requested',
      tenantId,
      certificateId: oldCertId,
      reason: 'datos cambiados',
      occurredAt: new Date().toISOString(),
    });

    expect(r.certificateId).toBe('cert-new');
    expect(mockClient.certificate.update).toHaveBeenCalledWith({
      where: { id: oldCertId },
      data: { status: 'reissued', reason: 'datos cambiados' },
    });
    const newData = mockClient.certificate.create.mock.calls[0][0].data;
    expect(newData.version).toBe(3);
    expect(newData.reissueOf).toBe(oldCertId);
  });

  it('si Puppeteer lanza PDF_RENDER_TIMEOUT → cert revoked + failure event', async () => {
    const { mockClient, prismaBypass, s3, sqs, puppeteer } = makeMocks();
    const tenantId = '11111111-1111-1111-1111-111111111111';
    mockClient.insured.findFirst.mockResolvedValue({
      id: 'i1',
      tenantId,
      packageId: 'p1',
      fullName: 'Y',
      curp: 'CURP',
      validFrom: new Date('2026-01-01'),
      validTo: new Date('2026-12-31'),
      package: { id: 'p1', name: 'P', coverages: [] },
    });
    mockClient.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'T', slug: 'mac', brandJson: null });
    mockClient.package.findFirst.mockResolvedValue({ id: 'p1', name: 'P', coverages: [] });
    (puppeteer.renderPdf as jest.Mock).mockRejectedValueOnce(new Error('PDF_RENDER_TIMEOUT'));
    mockClient.certificate.create.mockResolvedValue({ id: 'cert-failed' });

    const worker = new PdfWorkerService(prismaBypass, s3, sqs, puppeteer, makeEnv());
    const r = await worker.handleEvent({
      kind: 'insured.created',
      tenantId,
      insuredId: 'i1',
      packageId: 'p1',
      source: { batchId: 'b', rowNumber: 1 },
      occurredAt: new Date().toISOString(),
    });
    expect(r.certificateId).toBe('cert-failed');
    expect(s3.putObject).not.toHaveBeenCalled();
    const data = mockClient.certificate.create.mock.calls[0][0].data;
    expect(data.status).toBe('revoked');
    expect(String(data.reason)).toMatch(/generation_failed/);
  });

  it('upload S3 incluye metadata x-tenant-id, x-insured-id, x-version, x-hash', async () => {
    const { mockClient, prismaBypass, s3, sqs, puppeteer } = makeMocks();
    const tenantId = '11111111-1111-1111-1111-111111111111';
    mockClient.insured.findFirst.mockResolvedValue({
      id: 'i1',
      tenantId,
      packageId: 'p1',
      fullName: 'Y',
      curp: 'CURP',
      validFrom: new Date('2026-01-01'),
      validTo: new Date('2026-12-31'),
      package: { id: 'p1', name: 'P', coverages: [] },
    });
    mockClient.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'T', slug: 'mac', brandJson: null });
    mockClient.package.findFirst.mockResolvedValue({ id: 'p1', name: 'P', coverages: [] });
    mockClient.certificate.create.mockResolvedValue({ id: 'c1' });

    const worker = new PdfWorkerService(prismaBypass, s3, sqs, puppeteer, makeEnv());
    await worker.handleEvent({
      kind: 'insured.created',
      tenantId,
      insuredId: 'i1',
      packageId: 'p1',
      source: { batchId: 'b', rowNumber: 1 },
      occurredAt: new Date().toISOString(),
    });
    const meta = (s3.putObject as jest.Mock).mock.calls[0][0].Metadata;
    expect(meta['x-tenant-id']).toBe(tenantId);
    expect(meta['x-insured-id']).toBe('i1');
    expect(meta['x-version']).toBe('1');
    expect(meta['x-hash']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('persistencia: hash es SHA-256 hex (64 chars), s3Key matchea version', async () => {
    const { mockClient, prismaBypass, s3, sqs, puppeteer } = makeMocks();
    const tenantId = '11111111-1111-1111-1111-111111111111';
    mockClient.insured.findFirst.mockResolvedValue({
      id: 'i1',
      tenantId,
      packageId: 'p1',
      fullName: 'Y',
      curp: 'CURP',
      validFrom: new Date('2026-01-01'),
      validTo: new Date('2026-12-31'),
      package: { id: 'p1', name: 'P', coverages: [] },
    });
    mockClient.tenant.findFirst.mockResolvedValue({ id: tenantId, name: 'T', slug: 'mac', brandJson: null });
    mockClient.package.findFirst.mockResolvedValue({ id: 'p1', name: 'P', coverages: [] });
    mockClient.certificate.create.mockResolvedValue({ id: 'c1' });

    const worker = new PdfWorkerService(prismaBypass, s3, sqs, puppeteer, makeEnv());
    await worker.handleEvent({
      kind: 'insured.created',
      tenantId,
      insuredId: 'i1',
      packageId: 'p1',
      source: { batchId: 'b', rowNumber: 1 },
      occurredAt: new Date().toISOString(),
    });
    const data = mockClient.certificate.create.mock.calls[0][0].data;
    expect(data.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.s3Key).toMatch(/v1\.pdf$/);
    expect(data.qrPayload).toMatch(/\/v1\/certificates\/verify\/[a-f0-9]{64}$/);
  });

  it('NO emite issued si tenant no existe (lanza error semántico)', async () => {
    const { mockClient, prismaBypass, s3, sqs, puppeteer } = makeMocks();
    mockClient.insured.findFirst.mockResolvedValue({
      id: 'i1',
      tenantId: 't1',
      packageId: 'p1',
      package: { id: 'p1', name: 'P', coverages: [] },
    });
    mockClient.tenant.findFirst.mockResolvedValue(null);
    const worker = new PdfWorkerService(prismaBypass, s3, sqs, puppeteer, makeEnv());
    await expect(
      worker.handleEvent({
        kind: 'insured.created',
        tenantId: 't1',
        insuredId: 'i1',
        packageId: 'p1',
        source: { batchId: 'b', rowNumber: 1 },
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/tenant/);
    expect(sqs.sendMessage).not.toHaveBeenCalled();
  });
});
