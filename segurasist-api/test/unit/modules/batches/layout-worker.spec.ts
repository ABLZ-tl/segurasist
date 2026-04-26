/**
 * Unit tests para `LayoutWorkerService.processBatch`. Testeamos sin tocar SQS:
 * inyectamos PrismaBypassRlsService mockeado, S3 mockeado y verificamos que
 *   - parsea XLSX/CSV
 *   - persiste batch_errors en chunks
 *   - actualiza batch.status a preview_ready
 *   - publica evento batch.preview_ready
 *   - es idempotente (DELETE batch_errors antes de re-procesar)
 */
import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import type { Env } from '@config/env.schema';
import type { S3Service } from '@infra/aws/s3.service';
import type { SqsService } from '@infra/aws/sqs.service';
import { BatchesParserService } from '@modules/batches/parser/batches-parser.service';
import { BatchesValidatorService } from '@modules/batches/validator/batches-validator.service';
import { computeCurpChecksum } from '@modules/batches/validator/curp-checksum';
import ExcelJS from 'exceljs';
import { mock, mockDeep } from 'jest-mock-extended';
import { LayoutWorkerService } from '../../../../src/workers/layout-worker.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const BATCH_ID = '22222222-2222-2222-2222-222222222222';
const ENV: Env = {
  AWS_REGION: 'us-east-1',
  AWS_ENDPOINT_URL: 'http://localhost:4566',
  S3_BUCKET_UPLOADS: 'segurasist-dev-uploads',
  KMS_KEY_ID: 'alias/segurasist-dev',
  SQS_QUEUE_LAYOUT: 'http://localhost:4566/000000000000/layout-validation-queue',
  SQS_QUEUE_PDF: 'http://localhost:4566/000000000000/pdf-queue',
} as unknown as Env;

async function buildXlsxBuffer(rows: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Asegurados');
  ws.addRow(['curp', 'nombre_completo', 'fecha_nacimiento', 'paquete', 'vigencia_inicio', 'vigencia_fin']);
  for (let i = 0; i < rows; i += 1) {
    // Generamos prefixes pseudo-aleatorios pero deterministas.
    const prefix = `XYZA0001${String(i % 31).padStart(2, '0')}HCMABCD${String(i % 10)}`.slice(0, 17);
    const dv = computeCurpChecksum(prefix);
    ws.addRow([`${prefix}${dv}`, `Persona ${i}`, '1990-01-01', 'Premium', '2026-01-01', '2026-12-31']);
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('LayoutWorkerService', () => {
  it('procesa un batch XLSX con 3 filas y marca preview_ready', async () => {
    const buf = await buildXlsxBuffer(3);

    const prismaBypass = mockDeep<PrismaBypassRlsService>();
    prismaBypass.isEnabled.mockReturnValue(true);
    prismaBypass.client.package.findMany.mockResolvedValue([{ id: 'p-prem', name: 'Premium' }] as never);
    prismaBypass.client.insured.findMany.mockResolvedValue([] as never);
    prismaBypass.client.batchError.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaBypass.client.batchError.createMany.mockResolvedValue({ count: 0 } as never);
    prismaBypass.client.batch.update.mockResolvedValue({} as never);

    const s3 = mock<S3Service>();
    s3.getObject.mockResolvedValue(buf);
    const sqs = mock<SqsService>();

    const parser = new BatchesParserService();
    const validator = new BatchesValidatorService();

    const worker = new LayoutWorkerService(prismaBypass, s3, sqs, parser, validator, ENV);
    await worker.processBatch({
      kind: 'batch.validate',
      batchId: BATCH_ID,
      tenantId: TENANT_ID,
      s3Key: `uploads/${TENANT_ID}/${BATCH_ID}/file.xlsx`,
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(prismaBypass.client.batchError.deleteMany).toHaveBeenCalledWith({ where: { batchId: BATCH_ID } });
    expect(prismaBypass.client.batch.update).toHaveBeenCalled();
    // El último update debe poner status preview_ready.
    const lastCall = prismaBypass.client.batch.update.mock.calls.at(-1)![0] as {
      where: { id: string };
      data: { status: string };
    };
    expect(lastCall.where.id).toBe(BATCH_ID);
    expect(lastCall.data.status).toBe('preview_ready');
    expect(sqs.sendMessage).toHaveBeenCalled();
    const sqsCallArgs = sqs.sendMessage.mock.calls[0]!;
    const event = sqsCallArgs[1];
    expect(event.kind).toBe('batch.preview_ready');
  });

  it('marca batch failed cuando el parsing del archivo entero falla', async () => {
    const prismaBypass = mockDeep<PrismaBypassRlsService>();
    prismaBypass.isEnabled.mockReturnValue(true);
    prismaBypass.client.batchError.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaBypass.client.batchError.create.mockResolvedValue({} as never);
    prismaBypass.client.batch.update.mockResolvedValue({} as never);

    const s3 = mock<S3Service>();
    // Buffer corrupto
    s3.getObject.mockResolvedValue(Buffer.from('not-an-xlsx'));
    const sqs = mock<SqsService>();
    const worker = new LayoutWorkerService(
      prismaBypass,
      s3,
      sqs,
      new BatchesParserService(),
      new BatchesValidatorService(),
      ENV,
    );
    await worker.processBatch({
      kind: 'batch.validate',
      batchId: BATCH_ID,
      tenantId: TENANT_ID,
      s3Key: 'k',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(prismaBypass.client.batch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });
});
