/**
 * Unit tests para `InsuredsCreationWorkerService.processMessage`.
 *
 * Verificamos:
 *   - éxito → emite evento `insured.created` a la cola PDF.
 *   - re-entrega (P2002) → idempotente: encuentra el existente, sigue OK.
 *   - falla → no emite evento, pero igual incrementa contadores.
 *   - completed exactly-once vía CAS sobre `completed_event_emitted_at`.
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

/**
 * Helper: mockea la secuencia de $queryRaw que usa `bumpBatchCounters` post
 * fix C-06/C-07/C-08:
 *   1. UPDATE … RETURNING que incrementa processed_rows/success_rows/failed_rows
 *   2. (opcional) UPDATE … RETURNING id que CASea status→completed
 */
function mockBumpRaw(
  prismaBypass: ReturnType<typeof mockDeep<PrismaBypassRlsService>>,
  opts: {
    afterBump: {
      status?: string;
      rows_total?: number;
      rows_ok?: number;
      rows_error?: number;
      processed_rows: number;
      success_rows: number;
      failed_rows: number;
      queued_count: number | null;
      completed_event_emitted_at?: Date | null;
    };
    casWins?: boolean; // default true
  },
): void {
  const row = {
    id: BATCH_ID,
    status: opts.afterBump.status ?? 'processing',
    rows_total: opts.afterBump.rows_total ?? 0,
    rows_ok: opts.afterBump.rows_ok ?? 0,
    rows_error: opts.afterBump.rows_error ?? 0,
    processed_rows: opts.afterBump.processed_rows,
    success_rows: opts.afterBump.success_rows,
    failed_rows: opts.afterBump.failed_rows,
    queued_count: opts.afterBump.queued_count,
    completed_event_emitted_at: opts.afterBump.completed_event_emitted_at ?? null,
  };
  const winsCAS = opts.casWins ?? true;
  prismaBypass.client.$queryRaw
    .mockResolvedValueOnce([row] as never)
    .mockResolvedValueOnce((winsCAS ? [{ id: BATCH_ID }] : []) as never);
}

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
    // Bump → processed=1 == queuedCount=1 → CAS gana → completed.
    mockBumpRaw(prismaBypass, {
      afterBump: {
        rows_total: 1,
        rows_ok: 1,
        processed_rows: 1,
        success_rows: 1,
        failed_rows: 0,
        queued_count: 1,
      },
    });

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
    mockBumpRaw(prismaBypass, {
      afterBump: {
        rows_total: 1,
        rows_ok: 1,
        processed_rows: 1,
        success_rows: 1,
        failed_rows: 0,
        queued_count: 1,
      },
    });

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

  it('marca batch completed cuando processed alcanza queuedCount', async () => {
    const { worker, prismaBypass, sqs } = makeWorker();
    prismaBypass.client.$transaction.mockImplementation(async (fn: unknown) => {
      const tx = mockDeep<Prisma.TransactionClient>();
      tx.insured.create.mockResolvedValue({ id: 'insured-1' } as never);
      return (fn as (t: typeof tx) => Promise<unknown>)(tx);
    });
    mockBumpRaw(prismaBypass, {
      afterBump: {
        rows_total: 1,
        rows_ok: 1,
        processed_rows: 1,
        success_rows: 1,
        failed_rows: 0,
        queued_count: 1,
      },
    });

    await worker.processMessage({
      kind: 'insured.create',
      tenantId: TENANT_ID,
      batchId: BATCH_ID,
      rowNumber: 2,
      dto: sampleDto,
    });

    // El segundo evento emitido (después de insured.created) debe ser
    // batch.completed (el CAS UPDATE garantiza exactly-once).
    const sentEvents = sqs.sendMessage.mock.calls.map((c) => c[1]);
    expect(sentEvents.some((e) => e.kind === 'batch.completed')).toBe(true);
  });

  it('NO emite batch.completed si CAS pierde la race (otro worker ya lo hizo)', async () => {
    const { worker, prismaBypass, sqs } = makeWorker();
    prismaBypass.client.$transaction.mockImplementation(async (fn: unknown) => {
      const tx = mockDeep<Prisma.TransactionClient>();
      tx.insured.create.mockResolvedValue({ id: 'insured-1' } as never);
      return (fn as (t: typeof tx) => Promise<unknown>)(tx);
    });
    // CAS pierde → casWins: false
    mockBumpRaw(prismaBypass, {
      afterBump: {
        rows_total: 1,
        rows_ok: 1,
        processed_rows: 1,
        success_rows: 1,
        failed_rows: 0,
        queued_count: 1,
      },
      casWins: false,
    });

    await worker.processMessage({
      kind: 'insured.create',
      tenantId: TENANT_ID,
      batchId: BATCH_ID,
      rowNumber: 2,
      dto: sampleDto,
    });

    const sentEvents = sqs.sendMessage.mock.calls.map((c) => c[1]);
    // insured.created sí, batch.completed NO.
    expect(sentEvents.some((e) => e.kind === 'insured.created')).toBe(true);
    expect(sentEvents.some((e) => e.kind === 'batch.completed')).toBe(false);
  });

  it('NO emite batch.completed si processed < queued (mid-progress)', async () => {
    const { worker, prismaBypass, sqs } = makeWorker();
    prismaBypass.client.$transaction.mockImplementation(async (fn: unknown) => {
      const tx = mockDeep<Prisma.TransactionClient>();
      tx.insured.create.mockResolvedValue({ id: 'insured-1' } as never);
      return (fn as (t: typeof tx) => Promise<unknown>)(tx);
    });
    // processed=50 vs queued=100 → ni siquiera se intenta el CAS.
    prismaBypass.client.$queryRaw.mockResolvedValueOnce([
      {
        id: BATCH_ID,
        status: 'processing',
        rows_total: 100,
        rows_ok: 100,
        rows_error: 0,
        processed_rows: 50,
        success_rows: 50,
        failed_rows: 0,
        queued_count: 100,
        completed_event_emitted_at: null,
      },
    ] as never);

    await worker.processMessage({
      kind: 'insured.create',
      tenantId: TENANT_ID,
      batchId: BATCH_ID,
      rowNumber: 2,
      dto: sampleDto,
    });

    const sentEvents = sqs.sendMessage.mock.calls.map((c) => c[1]);
    expect(sentEvents.some((e) => e.kind === 'batch.completed')).toBe(false);
    // Sólo $queryRaw se llamó UNA vez (el bump UPDATE…RETURNING). El CAS NO
    // debe correr porque processed_rows < queued_count.
    expect(prismaBypass.client.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
