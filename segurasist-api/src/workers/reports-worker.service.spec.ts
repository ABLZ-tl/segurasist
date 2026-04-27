/**
 * Unit tests del ReportsWorkerService (S3-09).
 *
 * Mockeamos:
 *   - PrismaBypassRlsService → DB IO
 *   - S3Service → upload + presigned
 *   - PuppeteerService → PDF render
 *   - AuditWriterService → record (fire-and-forget)
 *   - SQS client → no aplica para handleEvent (lo invocamos directo)
 *
 * NO testeamos el polling loop (es tiempo real); los e2e cubren la integración
 * SQS → DB → S3 con LocalStack.
 */
import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import type { Env } from '@config/env.schema';
import type { S3Service } from '@infra/aws/s3.service';
import type { AuditWriterService } from '@modules/audit/audit-writer.service';
import type { PuppeteerService } from '@modules/certificates/puppeteer.service';
import { Logger } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { ReportsWorkerService } from './reports-worker.service';

// Silenciar pino logs en tests.
Logger.overrideLogger(false);

const ENV: Env = {
  AWS_REGION: 'us-east-1',
  NODE_ENV: 'test',
  S3_BUCKET_EXPORTS: 'segurasist-dev-exports',
  KMS_KEY_ID: 'alias/segurasist-dev',
  SQS_QUEUE_REPORTS: 'http://localhost:4566/000000000000/reports-queue',
} as unknown as Env;

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const EXPORT_ID = '22222222-2222-2222-2222-222222222222';
const REQUESTED_BY = '33333333-3333-3333-3333-333333333333';

interface Deps {
  worker: ReportsWorkerService;
  prismaBypass: DeepMockProxy<PrismaBypassRlsService>;
  s3: DeepMockProxy<S3Service>;
  puppeteer: DeepMockProxy<PuppeteerService>;
  audit: DeepMockProxy<AuditWriterService>;
}

function build(): Deps {
  const prismaBypass = mockDeep<PrismaBypassRlsService>();
  const s3 = mockDeep<S3Service>();
  const puppeteer = mockDeep<PuppeteerService>();
  const audit = mockDeep<AuditWriterService>();
  const worker = new ReportsWorkerService(prismaBypass, s3, puppeteer, audit, ENV);
  return { worker, prismaBypass, s3, puppeteer, audit };
}

function makeInsuredRow(idx: number): Record<string, unknown> {
  return {
    id: `i-${idx}`,
    curp: `PERF${String(idx).padStart(14, '0')}`,
    rfc: null,
    fullName: `User ${idx}`,
    email: `u${idx}@perf.local`,
    phone: null,
    validFrom: new Date('2026-01-01'),
    validTo: new Date('2027-01-01'),
    status: 'active',
    metadata: null,
    package: { name: 'Básico' },
  };
}

describe('ReportsWorkerService', () => {
  describe('handleEvent — XLSX', () => {
    it('genera XLSX, calcula hash, sube a S3 SSE-KMS, marca ready + audit completed', async () => {
      const { worker, prismaBypass, s3, audit } = build();
      // Export row pendiente.
      prismaBypass.client.export.findFirst.mockResolvedValue({
        id: EXPORT_ID,
        tenantId: TENANT_ID,
        requestedBy: REQUESTED_BY,
        status: 'pending',
        format: 'xlsx',
      } as never);
      // Query: 3 filas.
      prismaBypass.client.insured.findMany.mockResolvedValueOnce([0, 1, 2].map(makeInsuredRow) as never);
      // Segundo lote vacío → corta paginación.
      prismaBypass.client.insured.findMany.mockResolvedValueOnce([] as never);
      prismaBypass.client.export.update.mockResolvedValue({} as never);

      const result = await worker.handleEvent({
        kind: 'export.requested',
        exportId: EXPORT_ID,
        tenantId: TENANT_ID,
        insuredKind: 'insureds',
        format: 'xlsx',
        filters: { status: 'active' },
      });

      expect(result).toEqual({ status: 'ready' });
      // S3 putObject con SSE-KMS.
      expect(s3.putObject).toHaveBeenCalledTimes(1);
      const putCall = s3.putObject.mock.calls[0]?.[0];
      expect(putCall?.Bucket).toBe(ENV.S3_BUCKET_EXPORTS);
      expect(putCall?.Key).toMatch(new RegExp(`^exports/${TENANT_ID}/${EXPORT_ID}\\.xlsx$`));
      expect(putCall?.ServerSideEncryption).toBe('aws:kms');
      expect(putCall?.SSEKMSKeyId).toBe(ENV.KMS_KEY_ID);
      expect((putCall?.Metadata as Record<string, string>)['x-tenant-id']).toBe(TENANT_ID);
      expect((putCall?.Metadata as Record<string, string>)['x-format']).toBe('xlsx');
      // Update status=ready con hash + rowCount.
      const updateCalls = prismaBypass.client.export.update.mock.calls;
      const readyUpdate = updateCalls.find(
        (c) => (c[0] as { data?: { status?: string } }).data?.status === 'ready',
      );
      expect(readyUpdate).toBeDefined();
      const data = (readyUpdate![0] as { data: Record<string, unknown> }).data;
      expect(data.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(data.rowCount).toBe(3);
      expect(data.s3Key).toBeDefined();
      // Audit completed.
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'export',
          payloadDiff: expect.objectContaining({ subAction: 'completed', rowCount: 3 }),
        }),
      );
    });

    it('idempotente: si export ya está ready, skipea sin re-trabajar', async () => {
      const { worker, prismaBypass, s3 } = build();
      prismaBypass.client.export.findFirst.mockResolvedValue({
        id: EXPORT_ID,
        tenantId: TENANT_ID,
        requestedBy: REQUESTED_BY,
        status: 'ready',
        format: 'xlsx',
      } as never);
      const result = await worker.handleEvent({
        kind: 'export.requested',
        exportId: EXPORT_ID,
        tenantId: TENANT_ID,
        insuredKind: 'insureds',
        format: 'xlsx',
        filters: {},
      });
      expect(result).toEqual({ status: 'skipped' });
      expect(s3.putObject).not.toHaveBeenCalled();
    });
  });

  describe('handleEvent — PDF', () => {
    it('renderiza PDF via Puppeteer (mocked) y persiste con format=pdf metadata', async () => {
      const { worker, prismaBypass, s3, puppeteer } = build();
      prismaBypass.client.export.findFirst.mockResolvedValue({
        id: EXPORT_ID,
        tenantId: TENANT_ID,
        requestedBy: REQUESTED_BY,
        status: 'pending',
        format: 'pdf',
      } as never);
      prismaBypass.client.insured.findMany.mockResolvedValueOnce([0, 1].map(makeInsuredRow) as never);
      prismaBypass.client.insured.findMany.mockResolvedValueOnce([] as never);
      puppeteer.renderPdf.mockResolvedValue({
        pdf: Buffer.from('%PDF-1.7 fake'),
        durationMs: 50,
      });

      const result = await worker.handleEvent({
        kind: 'export.requested',
        exportId: EXPORT_ID,
        tenantId: TENANT_ID,
        insuredKind: 'insureds',
        format: 'pdf',
        filters: {},
      });

      expect(result).toEqual({ status: 'ready' });
      expect(puppeteer.renderPdf).toHaveBeenCalledTimes(1);
      const putCall = s3.putObject.mock.calls[0]?.[0];
      expect(putCall?.Key).toMatch(/\.pdf$/);
      expect(putCall?.ContentType).toBe('application/pdf');
      expect((putCall?.Metadata as Record<string, string>)['x-format']).toBe('pdf');
    });

    it('PDF vacío con 0 filas: aún sube el archivo (rowCount=0)', async () => {
      const { worker, prismaBypass, s3, puppeteer } = build();
      prismaBypass.client.export.findFirst.mockResolvedValue({
        id: EXPORT_ID,
        tenantId: TENANT_ID,
        requestedBy: REQUESTED_BY,
        status: 'pending',
        format: 'pdf',
      } as never);
      prismaBypass.client.insured.findMany.mockResolvedValueOnce([] as never);
      puppeteer.renderPdf.mockResolvedValue({
        pdf: Buffer.from('%PDF-1.7 empty'),
        durationMs: 30,
      });
      const result = await worker.handleEvent({
        kind: 'export.requested',
        exportId: EXPORT_ID,
        tenantId: TENANT_ID,
        insuredKind: 'insureds',
        format: 'pdf',
        filters: { status: 'cancelled' },
      });
      expect(result).toEqual({ status: 'ready' });
      expect(s3.putObject).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleEvent — failure', () => {
    it('si Puppeteer rejecta, marca export failed + audit failed', async () => {
      const { worker, prismaBypass, puppeteer, audit } = build();
      prismaBypass.client.export.findFirst.mockResolvedValue({
        id: EXPORT_ID,
        tenantId: TENANT_ID,
        requestedBy: REQUESTED_BY,
        status: 'pending',
        format: 'pdf',
      } as never);
      prismaBypass.client.insured.findMany.mockResolvedValueOnce([makeInsuredRow(0)] as never);
      prismaBypass.client.insured.findMany.mockResolvedValueOnce([] as never);
      puppeteer.renderPdf.mockRejectedValue(new Error('PDF_RENDER_TIMEOUT'));
      const result = await worker.handleEvent({
        kind: 'export.requested',
        exportId: EXPORT_ID,
        tenantId: TENANT_ID,
        insuredKind: 'insureds',
        format: 'pdf',
        filters: {},
      });
      expect(result).toEqual({ status: 'failed' });
      const failedUpdate = prismaBypass.client.export.update.mock.calls.find(
        (c) => (c[0] as { data?: { status?: string } }).data?.status === 'failed',
      );
      expect(failedUpdate).toBeDefined();
      expect((failedUpdate![0] as { data: Record<string, unknown> }).data.error).toContain(
        'PDF_RENDER_TIMEOUT',
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadDiff: expect.objectContaining({ subAction: 'failed' }),
        }),
      );
    });
  });
});
