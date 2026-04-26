/**
 * Unit tests para `InsuredsCreationWorkerService.processMessage`.
 *
 * Verificamos:
 *   - éxito → emite evento `insured.created` a la cola PDF.
 *   - re-entrega (P2002) → idempotente: encuentra el existente, sigue OK.
 *   - falla → no emite evento, pero igual incrementa contadores.
 */
import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import type { Env } from '@config/env.schema';
import type { SqsService } from '@infra/aws/sqs.service';
import type { CreateInsuredDto } from '@modules/insureds/dto/insured.dto';
import { Prisma } from '@prisma/client';
import { mock, mockDeep } from 'jest-mock-extended';
import { InsuredsCreationWorkerService } from '../../../../src/workers/insureds-creation-worker.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const BATCH_ID = '22222222-2222-2222-2222-222222222222';
const ENV: Env = {
  AWS_REGION: 'us-east-1',
  AWS_ENDPOINT_URL: 'http://localhost:4566',
  SQS_QUEUE_LAYOUT: 'http://localhost:4566/000000000000/layout-validation-queue',
  SQS_QUEUE_PDF: 'http://localhost:4566/000000000000/pdf-queue',
} as unknown as Env;

const sampleDto: CreateInsuredDto = {
  curp: 'HEGM860519MJCRRN08',
  fullName: 'María Hernández',
  dob: '1986-05-19',
  packageId: '00000000-0000-0000-0000-000000000aaa',
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
};

describe('InsuredsCreationWorkerService', () => {
  function makeWorker() {
    const prismaBypass = mockDeep<PrismaBypassRlsService>();
    prismaBypass.isEnabled.mockReturnValue(true);
    const sqs = mock<SqsService>();
    const worker = new InsuredsCreationWorkerService(prismaBypass, sqs, ENV);
    return { worker, prismaBypass, sqs };
  }

  it('crea un insured y emite evento insured.created', async () => {
    const { worker, prismaBypass, sqs } = makeWorker();
    prismaBypass.client.$transaction.mockImplementation(async (fn: unknown) => {
      const tx = mockDeep<Prisma.TransactionClient>();
      tx.insured.create.mockResolvedValue({ id: 'insured-1' } as never);
      tx.beneficiary.createMany.mockResolvedValue({ count: 0 } as never);
      return (fn as (t: typeof tx) => Promise<unknown>)(tx);
    });
    prismaBypass.client.$executeRaw.mockResolvedValue(1 as never);
    prismaBypass.client.batch.findFirst.mockResolvedValue({
      id: BATCH_ID,
      status: 'processing',
      rowsTotal: 1,
      rowsOk: 1,
      rowsError: 0,
    } as never);
    prismaBypass.client.batch.update.mockResolvedValue({} as never);

    await worker.processMessage({
      kind: 'insured.create',
      tenantId: TENANT_ID,
      batchId: BATCH_ID,
      rowNumber: 2,
      dto: sampleDto,
    });

    // Evento insured.created emitido a la cola PDF.
    const calls = sqs.sendMessage.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const insuredEvent = calls[0]![1];
    expect(insuredEvent.kind).toBe('insured.created');
    expect(insuredEvent.insuredId).toBe('insured-1');
  });

  it('si curp ya existe (P2002), busca el existente y sigue OK', async () => {
    const { worker, prismaBypass, sqs } = makeWorker();
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '5.19.1',
    });
    prismaBypass.client.$transaction.mockRejectedValue(p2002);
    prismaBypass.client.insured.findFirst.mockResolvedValue({ id: 'existing-1' } as never);
    prismaBypass.client.$executeRaw.mockResolvedValue(1 as never);
    prismaBypass.client.batch.findFirst.mockResolvedValue({
      id: BATCH_ID,
      status: 'processing',
      rowsTotal: 1,
      rowsOk: 1,
      rowsError: 0,
    } as never);
    prismaBypass.client.batch.update.mockResolvedValue({} as never);

    await worker.processMessage({
      kind: 'insured.create',
      tenantId: TENANT_ID,
      batchId: BATCH_ID,
      rowNumber: 2,
      dto: sampleDto,
    });

    expect(sqs.sendMessage).toHaveBeenCalled();
    const event = sqs.sendMessage.mock.calls[0]![1];
    expect(event.insuredId).toBe('existing-1');
  });

  it('marca batch completed cuando processed alcanza rowsTotal', async () => {
    const { worker, prismaBypass, sqs } = makeWorker();
    prismaBypass.client.$transaction.mockImplementation(async (fn: unknown) => {
      const tx = mockDeep<Prisma.TransactionClient>();
      tx.insured.create.mockResolvedValue({ id: 'insured-1' } as never);
      return (fn as (t: typeof tx) => Promise<unknown>)(tx);
    });
    prismaBypass.client.$executeRaw.mockResolvedValue(1 as never);
    prismaBypass.client.batch.findFirst.mockResolvedValue({
      id: BATCH_ID,
      status: 'processing',
      rowsTotal: 1,
      rowsOk: 1,
      rowsError: 0,
    } as never);
    prismaBypass.client.batch.update.mockResolvedValue({} as never);

    await worker.processMessage({
      kind: 'insured.create',
      tenantId: TENANT_ID,
      batchId: BATCH_ID,
      rowNumber: 2,
      dto: sampleDto,
    });

    // batch.update con status completed debió ser invocado.
    const updateCalls = prismaBypass.client.batch.update.mock.calls.map(
      (c) => (c[0] as { data: { status?: string } }).data,
    );
    expect(updateCalls.some((d) => d.status === 'completed')).toBe(true);
    // Y el segundo evento debe ser batch.completed.
    const sentEvents = sqs.sendMessage.mock.calls.map((c) => c[1]);
    expect(sentEvents.some((e) => e.kind === 'batch.completed')).toBe(true);
  });
});
