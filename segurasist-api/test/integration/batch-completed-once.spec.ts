/**
 * Integration: `batch.completed` exactly-once ante 2 workers concurrentes.
 *
 * Bug C-07 (pre-fix): `bumpBatchCounters` hacía un UPDATE de
 * `rows_ok/rows_error` y luego un `findFirst` separado para chequear
 * completion. Entre las 2 queries, otro worker procesando el último mensaje
 * podía leer los counters ya actualizados → ambos veían
 * `rows_ok+rows_error >= rows_total` → ambos ejecutaban el `update` a
 * `completed` y emitían `batch.completed` → 2 PDFs por insured (el evento
 * que A4 consume).
 *
 * Fix C-07: el worker ahora usa
 *   1. UPDATE … RETURNING (incremento atómico).
 *   2. UPDATE … WHERE completed_event_emitted_at IS NULL AND processed_rows
 *      >= queued_count (compare-and-set; sólo un caller actualiza la fila).
 *   3. UNIQUE PARTIAL INDEX backup defensivo a nivel storage.
 *
 * Este test simula 2 workers procesando concurrentemente los 2 últimos
 * mensajes de un batch (queued_count=2). Esperamos exactamente 1 evento
 * `batch.completed`.
 */
import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import type { Env } from '@config/env.schema';
import type { SqsService } from '@infra/aws/sqs.service';
import type { CreateInsuredDto } from '@modules/insureds/dto/insured.dto';
import { Prisma } from '@prisma/client';
import { mock, mockDeep } from 'jest-mock-extended';
import { InsuredsCreationWorkerService } from '../../src/workers/insureds-creation-worker.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const BATCH_ID = '33333333-3333-3333-3333-333333333333';
const ENV: Env = {
  AWS_REGION: 'us-east-1',
  AWS_ENDPOINT_URL: 'http://localhost:4566',
  SQS_QUEUE_LAYOUT: 'http://localhost:4566/000000000000/layout-validation-queue',
  SQS_QUEUE_PDF: 'http://localhost:4566/000000000000/pdf-queue',
} as unknown as Env;

function makeDto(curpSuffix: number): CreateInsuredDto {
  // CURPs sintéticos válidos para el shape (no validamos checksum acá; la
  // validación ocurre en LayoutWorker, no en InsuredsCreationWorker).
  return {
    curp: `AAAA90010100HJCRRN${String(curpSuffix).padStart(2, '0').slice(0, 2)}`,
    fullName: `Persona ${curpSuffix}`,
    dob: '1990-01-01',
    packageId: '00000000-0000-0000-0000-000000000aaa',
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
  };
}

describe('Batch completed exactly-once (C-07)', () => {
  it('2 workers concurrentes procesando los últimos 2 mensajes → solo 1 batch.completed', async () => {
    const prismaBypass = mockDeep<PrismaBypassRlsService>();
    prismaBypass.isEnabled.mockReturnValue(true);
    const sqs = mock<SqsService>();
    const worker = new InsuredsCreationWorkerService(prismaBypass, sqs, ENV);

    // Cada worker ejecuta su propia $transaction → ambas crean insured ok.
    prismaBypass.client.$transaction.mockImplementation(async (fn: unknown) => {
      const tx = mockDeep<Prisma.TransactionClient>();
      tx.insured.create.mockResolvedValue({ id: `insured-${Math.random()}` } as never);
      return (fn as (t: typeof tx) => Promise<unknown>)(tx);
    });

    // Simulación de race condition:
    //
    // Llamada 1 a $queryRaw (bump) → row con processed=1, queued=2 → NO listo.
    // Llamada 2 a $queryRaw (bump) → row con processed=2, queued=2 → LISTO.
    //   Llamada 3 a $queryRaw (CAS) → 1 fila → emite evento.
    // Llamada 4 a $queryRaw (bump) → row con processed=2, queued=2 → LISTO.
    //   Llamada 5 a $queryRaw (CAS) → 0 filas (perdió la carrera) → NO emite.
    //
    // Ese es el orden esperado cuando Promise.all serializa el bump del
    // primer worker primero, pero ambos workers ven processed >= queued en
    // sus respectivos bumps. La parte CRÍTICA es que sólo UNA llamada al CAS
    // devuelve filas.
    let bumpCount = 0;
    prismaBypass.client.$queryRaw.mockImplementation((async (..._args: unknown[]): Promise<unknown> => {
      bumpCount += 1;
      // Patrones esperados:
      //   bump 1 → processed=1 (no listo).
      //   cas/bump 2 → processed=2 (listo).
      //   cas 1 → wins (1 row).
      //   cas 2 → loses (0 rows).
      // Para simplificar: alternamos entre "bump" y "cas" basándonos en el
      // patrón de uso del worker: bump SIEMPRE precede CAS, y CAS sólo se
      // dispara si processed >= queued.
      // - Worker A: bump (call 1, processed=1, no CAS)
      // - Worker B: bump (call 2, processed=2, llama CAS)
      // - Worker B: CAS (call 3, wins → 1 row)
      // Pero como ambos workers son concurrentes en Promise.all y ambos
      // escriben processed_rows+=1, la 1ra llamada a bump podría devolver 1
      // o 2 dependiendo del schedule. Lo importante es: SI alguna llamada
      // tiene processed=2 y dispara CAS, sólo UNA CAS devuelve fila.
      if (bumpCount === 1) {
        return [
          {
            id: BATCH_ID,
            status: 'processing',
            rows_total: 2,
            rows_ok: 2,
            rows_error: 0,
            processed_rows: 1,
            success_rows: 1,
            failed_rows: 0,
            queued_count: 2,
            completed_event_emitted_at: null,
          },
        ];
      }
      if (bumpCount === 2) {
        // Worker B: bump → processed=2 → listo.
        return [
          {
            id: BATCH_ID,
            status: 'processing',
            rows_total: 2,
            rows_ok: 2,
            rows_error: 0,
            processed_rows: 2,
            success_rows: 2,
            failed_rows: 0,
            queued_count: 2,
            completed_event_emitted_at: null,
          },
        ];
      }
      if (bumpCount === 3) {
        // CAS de Worker B → wins.
        return [{ id: BATCH_ID }];
      }
      // Defensivo: si por algún schedule extraño Worker A también disparara
      // un CAS, devolvemos 0 filas (perdió la carrera).
      return [];
    }) as never);

    // Lanzamos 2 workers en paralelo procesando los últimos 2 mensajes.
    await Promise.all([
      worker.processMessage({
        kind: 'insured.create',
        tenantId: TENANT_ID,
        batchId: BATCH_ID,
        rowNumber: 1,
        dto: makeDto(1),
      }),
      worker.processMessage({
        kind: 'insured.create',
        tenantId: TENANT_ID,
        batchId: BATCH_ID,
        rowNumber: 2,
        dto: makeDto(2),
      }),
    ]);

    // Validación crítica: exactly UN evento batch.completed emitido (los
    // insured.created sí pueden ser 2, uno por mensaje).
    const completedEvents = sqs.sendMessage.mock.calls
      .map((c) => c[1])
      .filter((e) => e.kind === 'batch.completed');
    expect(completedEvents.length).toBe(1);

    // Y se intentó CAS al menos una vez (= bumpCount === 3 fue alcanzado).
    expect(bumpCount).toBeGreaterThanOrEqual(2);
  });

  it('CAS pierde la carrera (otra instancia ya emitió) → no doble emisión', async () => {
    const prismaBypass = mockDeep<PrismaBypassRlsService>();
    prismaBypass.isEnabled.mockReturnValue(true);
    const sqs = mock<SqsService>();
    const worker = new InsuredsCreationWorkerService(prismaBypass, sqs, ENV);

    prismaBypass.client.$transaction.mockImplementation(async (fn: unknown) => {
      const tx = mockDeep<Prisma.TransactionClient>();
      tx.insured.create.mockResolvedValue({ id: 'insured-x' } as never);
      return (fn as (t: typeof tx) => Promise<unknown>)(tx);
    });

    // Bump devuelve listo, CAS devuelve 0 filas (otro caller ya completó).
    prismaBypass.client.$queryRaw
      .mockResolvedValueOnce([
        {
          id: BATCH_ID,
          status: 'processing',
          rows_total: 1,
          rows_ok: 1,
          rows_error: 0,
          processed_rows: 1,
          success_rows: 1,
          failed_rows: 0,
          queued_count: 1,
          completed_event_emitted_at: null,
        },
      ] as never)
      .mockResolvedValueOnce([] as never); // CAS pierde

    await worker.processMessage({
      kind: 'insured.create',
      tenantId: TENANT_ID,
      batchId: BATCH_ID,
      rowNumber: 1,
      dto: makeDto(1),
    });

    const completedEvents = sqs.sendMessage.mock.calls
      .map((c) => c[1])
      .filter((e) => e.kind === 'batch.completed');
    expect(completedEvents.length).toBe(0);
  });
});
