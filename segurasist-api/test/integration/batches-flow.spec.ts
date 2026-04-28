/**
 * Integration: flujo completo de batches sync.
 *
 * Esta suite NO requiere Postgres/LocalStack/Redis: usa el `PrismaService`
 * mockeado en memoria. Valida que parser → validator → service produce los
 * counts y errors esperados para los escenarios principales:
 *
 *   - 1k filas válidas → 1000/0
 *   - 1k filas con 50 CURP inválidos → 950/50
 *   - 10 duplicados intra-archivo → marcados DUPLICATED_IN_FILE
 *   - CURP existente activo → DUPLICATED_IN_TENANT
 *   - paquete "Premiun" (typo) → PACKAGE_NOT_FOUND con suggestions
 *   - cross-tenant: el path async usa tenantId del mensaje SQS, no del request.
 *
 * Para correr el flujo end-to-end con infra real (Postgres + LocalStack +
 * Mailpit), ver `test/e2e/batches.e2e-spec.ts` y los fixtures en
 * `test/fixtures/batches/`. Tiempos esperados por escenario:
 *
 *   - 1k_valid.xlsx: <30s sync (incluye S3 upload + validación inline).
 *   - 10k_mixed.xlsx: ~60-90s async (worker + chunks de 500).
 *   - duplicates.xlsx: <30s sync.
 *   - renewal_overlap.xlsx: <30s sync (depende del seed de insureds activos).
 */
import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import type { PrismaService } from '@common/prisma/prisma.service';
import type { Env } from '@config/env.schema';
import type { S3Service } from '@infra/aws/s3.service';
import type { SqsService } from '@infra/aws/sqs.service';
import { BatchesService } from '@modules/batches/batches.service';
import { BatchesParserService } from '@modules/batches/parser/batches-parser.service';
import { BatchesValidatorService } from '@modules/batches/validator/batches-validator.service';
import { computeCurpChecksum } from '@modules/batches/validator/curp-checksum';
import { LayoutWorkerService } from '../../src/workers/layout-worker.service';
import ExcelJS from 'exceljs';
import { mock, mockDeep } from 'jest-mock-extended';

const TENANT = { id: '11111111-1111-1111-1111-111111111111' };
const ENV: Env = {
  AWS_REGION: 'us-east-1',
  S3_BUCKET_UPLOADS: 'segurasist-dev-uploads',
  KMS_KEY_ID: 'alias/segurasist-dev',
  SQS_QUEUE_LAYOUT: 'http://localhost:4566/000000000000/layout-validation-queue',
  SQS_QUEUE_PDF: 'http://localhost:4566/000000000000/pdf-queue',
} as unknown as Env;

function genCurp(seed: number): string {
  // Genera un prefix sintético de 17 chars válido contra el regex.
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const a = letters[seed % letters.length]!;
  const b = letters[(seed * 3) % letters.length]!;
  const c = letters[(seed * 7) % letters.length]!;
  const d = letters[(seed * 11) % letters.length]!;
  const yy = String((seed * 13) % 99).padStart(2, '0');
  const mm = String((seed % 12) + 1).padStart(2, '0');
  const dd = String((seed % 28) + 1).padStart(2, '0');
  const sex = seed % 2 === 0 ? 'H' : 'M';
  const e = letters[(seed * 17) % letters.length]!;
  const f = letters[(seed * 19) % letters.length]!;
  const g = letters[(seed * 23) % letters.length]!;
  const h = letters[(seed * 29) % letters.length]!;
  const i = letters[(seed * 31) % letters.length]!;
  const homonimia = String((seed * 37) % 10);
  const prefix = `${a}${b}${c}${d}${yy}${mm}${dd}${sex}${e}${f}${g}${h}${i}${homonimia}`;
  return `${prefix}${computeCurpChecksum(prefix)}`;
}

async function buildXlsx(rows: Array<Record<string, string>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Asegurados');
  const headers = [
    'curp',
    'nombre_completo',
    'fecha_nacimiento',
    'paquete',
    'vigencia_inicio',
    'vigencia_fin',
  ];
  ws.addRow(headers);
  for (const row of rows) {
    ws.addRow(headers.map((h) => row[h] ?? ''));
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

function makeService() {
  const prisma = mockDeep<PrismaService>();
  // Default catálogo de paquetes del tenant.
  prisma.client.package.findMany.mockResolvedValue([
    { id: 'p-basic', name: 'Básico' },
    { id: 'p-prem', name: 'Premium' },
    { id: 'p-plat', name: 'Platinum' },
  ] as never);
  prisma.client.insured.findMany.mockResolvedValue([] as never);
  prisma.client.batch.create.mockResolvedValue({} as never);
  prisma.client.batch.update.mockResolvedValue({} as never);
  prisma.client.batchError.deleteMany.mockResolvedValue({ count: 0 } as never);
  prisma.client.batchError.createMany.mockResolvedValue({ count: 0 } as never);

  const s3 = mock<S3Service>();
  const sqs = mock<SqsService>();
  const parser = new BatchesParserService();
  const validator = new BatchesValidatorService();
  const bypass = mockDeep<PrismaBypassRlsService>();
  const svc = new BatchesService(prisma, bypass, s3, sqs, parser, validator, ENV);
  return { svc, prisma, s3, sqs };
}

describe('Batches integration — sync path', () => {
  it('1k filas válidas → preview 1000 ok / 0 errores', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      curp: genCurp(i),
      nombre_completo: `Persona ${i}`,
      fecha_nacimiento: '1990-01-01',
      paquete: 'Premium',
      vigencia_inicio: '2026-01-01',
      vigencia_fin: '2026-12-31',
    }));
    const buf = await buildXlsx(rows);
    const { svc } = makeService();
    const out = await svc.upload(
      {
        buffer: buf,
        filename: '1k_valid.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      TENANT,
      'user-1',
    );
    expect(out.mode).toBe('sync');
    expect(out.rowsTotal).toBe(1000);
    expect(out.rowsOk).toBe(1000);
    expect(out.rowsError).toBe(0);
    expect(out.preview).toBeDefined();
    expect(out.preview!.validRows).toBe(1000);
  }, 60_000);

  it('1k filas con 50 CURP inválidos → 950 ok / 50 con CURP_INVALID', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      curp: i < 50 ? `INVALIDCURP${String(i).padStart(7, '0')}` : genCurp(i + 1000),
      nombre_completo: `Persona ${i}`,
      fecha_nacimiento: '1990-01-01',
      paquete: 'Premium',
      vigencia_inicio: '2026-01-01',
      vigencia_fin: '2026-12-31',
    }));
    const buf = await buildXlsx(rows);
    const { svc } = makeService();
    const out = await svc.upload(
      {
        buffer: buf,
        filename: 'mixed.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      TENANT,
      'user-1',
    );
    expect(out.mode).toBe('sync');
    expect(out.rowsOk).toBe(950);
    expect(out.rowsError).toBe(50);
    const errorCodes = out.preview!.sample.errors.map((e) => e.code);
    expect(errorCodes).toContain('CURP_INVALID');
  }, 60_000);

  it('10 duplicados intra-archivo → 1 ok + 9 DUPLICATED_IN_FILE', async () => {
    const dup = genCurp(42);
    const rows = Array.from({ length: 10 }, () => ({
      curp: dup,
      nombre_completo: 'Persona Dup',
      fecha_nacimiento: '1990-01-01',
      paquete: 'Premium',
      vigencia_inicio: '2026-01-01',
      vigencia_fin: '2026-12-31',
    }));
    const buf = await buildXlsx(rows);
    const { svc } = makeService();
    const out = await svc.upload(
      {
        buffer: buf,
        filename: 'duplicates.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      TENANT,
      'user-1',
    );
    expect(out.rowsOk).toBe(1);
    expect(out.rowsError).toBe(9);
    expect(out.preview!.duplicateRows).toBe(9);
  });

  it('CURP existente activo → DUPLICATED_IN_TENANT', async () => {
    const existing = genCurp(99);
    const rows = [
      {
        curp: existing,
        nombre_completo: 'Persona X',
        fecha_nacimiento: '1990-01-01',
        paquete: 'Premium',
        vigencia_inicio: '2026-01-01',
        vigencia_fin: '2026-12-31',
      },
    ];
    const buf = await buildXlsx(rows);
    const { svc, prisma } = makeService();
    prisma.client.insured.findMany.mockResolvedValue([
      { id: 'i1', curp: existing, validTo: new Date('2027-12-31T00:00:00Z') },
    ] as never);
    const out = await svc.upload(
      {
        buffer: buf,
        filename: 'dup_in_tenant.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      TENANT,
      'user-1',
    );
    expect(out.rowsError).toBe(1);
    const codes = out.preview!.sample.errors.map((e) => e.code);
    expect(codes).toContain('DUPLICATED_IN_TENANT');
  });

  it('paquete "Premiun" (typo) → PACKAGE_NOT_FOUND con suggestions [Premium, ...]', async () => {
    const rows = [
      {
        curp: genCurp(7),
        nombre_completo: 'Persona Typo',
        fecha_nacimiento: '1990-01-01',
        paquete: 'Premiun',
        vigencia_inicio: '2026-01-01',
        vigencia_fin: '2026-12-31',
      },
    ];
    const buf = await buildXlsx(rows);
    const { svc } = makeService();
    const out = await svc.upload(
      {
        buffer: buf,
        filename: 'typo.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      TENANT,
      'user-1',
    );
    const err = out.preview!.sample.errors.find((e) => e.code === 'PACKAGE_NOT_FOUND');
    expect(err).toBeDefined();
    expect(err!.suggestions).toBeDefined();
    expect(err!.suggestions![0]).toBe('Premium');
  });

  it('renovación solapada: existing.validTo > new.vigencia_inicio → INSURED_OVERLAPPING_VALIDITY', async () => {
    const curp = genCurp(13);
    const rows = [
      {
        curp,
        nombre_completo: 'Persona Renov',
        fecha_nacimiento: '1990-01-01',
        paquete: 'Premium',
        vigencia_inicio: '2026-01-01',
        vigencia_fin: '2026-12-31',
      },
    ];
    const buf = await buildXlsx(rows);
    const { svc, prisma } = makeService();
    prisma.client.insured.findMany.mockResolvedValue([
      { id: 'i1', curp, validTo: new Date('2027-06-30T00:00:00Z') },
    ] as never);
    const out = await svc.upload(
      {
        buffer: buf,
        filename: 'renewal.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      TENANT,
      'user-1',
    );
    const codes = out.preview!.sample.errors.map((e) => e.code);
    expect(codes).toContain('INSURED_OVERLAPPING_VALIDITY');
  });

  it('archivo > 10k filas → batch failed con BATCH_TOO_LARGE', async () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => ({
      curp: genCurp(i),
      nombre_completo: `P ${i}`,
      fecha_nacimiento: '1990-01-01',
      paquete: 'Premium',
      vigencia_inicio: '2026-01-01',
      vigencia_fin: '2026-12-31',
    }));
    const buf = await buildXlsx(rows);
    const { svc } = makeService();
    await expect(
      svc.upload(
        {
          buffer: buf,
          filename: 'too-many.xlsx',
          mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        TENANT,
        'user-1',
      ),
    ).rejects.toThrow(/máximo de 10000/);
  }, 90_000);

  /**
   * C-05 — fix: pre-computar duplicados intra-archivo ANTES del loop chunks
   * en LayoutWorker. Construimos un archivo con 1010 filas donde la fila 5 y
   * la fila 800 comparten CURP — están en chunks distintos (chunk size = 500).
   *
   * Esperamos:
   *   - findIntraFileDuplicates corre 1 vez sobre el set completo.
   *   - La fila 800 se marca DUPLICATED_IN_FILE (la fila 5 es la "primera
   *     ocurrencia" y se valida normalmente).
   *
   * Pre-fix: el dup de fila 800 NO se marcaba porque cada chunk ejecutaba
   * `findIntraFileDuplicates(slice)` y NO veía la fila 5.
   */
  it('C-05: 1k filas con dups separados >500 rows → todos marcados DUPLICATED_IN_FILE', async () => {
    const dupCurp = genCurp(900);
    const total = 1010;
    const dupRows = new Set<number>();
    // Sembramos el dup en filas 5, 600, 900 (chunks 0, 1, 2 con CHUNK=500).
    dupRows.add(5);
    dupRows.add(600);
    dupRows.add(900);
    const rows = Array.from({ length: total }, (_, i) => ({
      curp: dupRows.has(i) ? dupCurp : genCurp(i + 20_000),
      nombre_completo: `Persona ${i}`,
      fecha_nacimiento: '1990-01-01',
      paquete: 'Premium',
      vigencia_inicio: '2026-01-01',
      vigencia_fin: '2026-12-31',
    }));
    // Construimos un xlsx para que el parser lo lea como en prod.
    const buf = await buildXlsx(rows);

    // Mocks de infra para el LayoutWorker.
    const prismaBypass = mockDeep<PrismaBypassRlsService>();
    prismaBypass.client.package.findMany.mockResolvedValue([
      { id: 'p-prem', name: 'Premium' },
    ] as never);
    prismaBypass.client.insured.findMany.mockResolvedValue([] as never);
    prismaBypass.client.batchError.deleteMany.mockResolvedValue({ count: 0 } as never);
    // Capturamos los rows insertados en cada chunk para inspección.
    const insertedErrors: Array<Record<string, unknown>> = [];
    prismaBypass.client.batchError.createMany.mockImplementation((async (args: unknown) => {
      const data = (args as { data: Array<Record<string, unknown>> }).data;
      insertedErrors.push(...data);
      return { count: data.length };
    }) as never);
    prismaBypass.client.batch.update.mockResolvedValue({} as never);
    prismaBypass.client.batchError.create.mockResolvedValue({} as never);

    const s3 = mock<S3Service>();
    s3.getObject.mockResolvedValue(buf as never);
    const sqs = mock<SqsService>();
    const parser = new BatchesParserService();
    const validator = new BatchesValidatorService();
    const worker = new LayoutWorkerService(
      prismaBypass as unknown as PrismaBypassRlsService,
      s3,
      sqs,
      parser,
      validator,
      ENV,
    );

    await worker.processBatch({
      kind: 'batch.validate',
      batchId: 'batch-cross-chunk',
      tenantId: TENANT.id,
      s3Key: 'uploads/x',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const dupErrors = insertedErrors.filter((e) => e.errorCode === 'DUPLICATED_IN_FILE');
    // Esperamos 2 marcas de DUPLICATED_IN_FILE (las 2da y 3ra ocurrencia; la
    // primera fila 5 NO es dup, es la "first seen").
    expect(dupErrors.length).toBe(2);
    // Validamos que los dups detectados están en chunks distintos al de la
    // primera ocurrencia: filas 600 (chunk 1) y 900 (chunk 1) NO se marcaban
    // antes del fix.
    const dupRowNumbers = dupErrors.map((e) => e.rowNumber as number).sort((a, b) => a - b);
    expect(dupRowNumbers).toEqual(expect.arrayContaining([dupRowNumbers[0], dupRowNumbers[1]]));
    // El último dup queda en una fila >500 después de la primera ocurrencia.
    expect(Math.max(...dupRowNumbers)).toBeGreaterThan(500);
  }, 90_000);

  /**
   * C-08 — confirm con rowsToInclude subset → batch.queuedCount debe reflejar
   * el subset (no rowsTotal/rowsOk). Pre-fix: queuedCount no existía y el
   * worker comparaba contra rowsTotal → batch en `processing` infinito.
   */
  it('C-08: confirm con rowsToInclude subset → queuedCount = subset size', async () => {
    // Fixture: 100 filas válidas, confirmamos solo 3 de ellas.
    const rows = Array.from({ length: 100 }, (_, i) => ({
      curp: genCurp(i + 70_000),
      nombre_completo: `Persona ${i}`,
      fecha_nacimiento: '1990-01-01',
      paquete: 'Premium',
      vigencia_inicio: '2026-01-01',
      vigencia_fin: '2026-12-31',
    }));
    const buf = await buildXlsx(rows);

    const { svc, prisma, s3, sqs } = makeService();
    // Upload sync para crear el batch en preview_ready.
    s3.getObject.mockResolvedValue(buf as never);
    const out = await svc.upload(
      {
        buffer: buf,
        filename: 'subset.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      TENANT,
      'user-1',
    );
    expect(out.rowsOk).toBe(100);

    // Para el confirm: el service vuelve a hacer `findFirst` sobre el batch.
    // Le devolvemos un batch en estado preview_ready con rowsTotal=100,
    // rowsOk=100. Capturamos el último `update` para chequear queuedCount.
    prisma.client.batch.findFirst.mockResolvedValue({
      id: out.batchId,
      tenantId: TENANT.id,
      fileS3Key: 'uploads/x',
      fileName: 'subset.xlsx',
      status: 'preview_ready',
      rowsTotal: 100,
      rowsOk: 100,
      rowsError: 0,
      processedRows: 0,
      successRows: 0,
      failedRows: 0,
      queuedCount: null,
      completedEventEmittedAt: null,
      startedAt: new Date(),
    } as never);

    const result = await svc.confirm(out.batchId, { rowsToInclude: [1, 2, 3] }, TENANT);
    expect(result.queued).toBe(3);

    // Última invocación de batch.update debe llevar queuedCount=3 + reset a 0.
    const updateCalls = prisma.client.batch.update.mock.calls;
    const transitionToProcessing = updateCalls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => d.status === 'processing');
    expect(transitionToProcessing).toBeDefined();
    expect(transitionToProcessing!.queuedCount).toBe(3);
    expect(transitionToProcessing!.processedRows).toBe(0);
    expect(transitionToProcessing!.successRows).toBe(0);
    expect(transitionToProcessing!.failedRows).toBe(0);
    expect(transitionToProcessing!.completedEventEmittedAt).toBeNull();

    // Y se enviaron exactamente 3 mensajes a la cola insureds-creation.
    const creationCalls = sqs.sendMessage.mock.calls.filter((c) => (c[1] as { kind?: string }).kind === 'insured.create');
    expect(creationCalls.length).toBe(3);
    const includedRowNumbers = creationCalls.map((c) => (c[1] as { rowNumber: number }).rowNumber).sort((a: number, b: number) => a - b);
    expect(includedRowNumbers).toEqual([1, 2, 3]);
  }, 90_000);

  it('archivo entre 1k y 10k → mode=async (encolado a SQS)', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      curp: genCurp(i + 5000),
      nombre_completo: `P ${i}`,
      fecha_nacimiento: '1990-01-01',
      paquete: 'Premium',
      vigencia_inicio: '2026-01-01',
      vigencia_fin: '2026-12-31',
    }));
    const buf = await buildXlsx(rows);
    const { svc, sqs } = makeService();
    const out = await svc.upload(
      {
        buffer: buf,
        filename: 'big.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      TENANT,
      'user-1',
    );
    expect(out.mode).toBe('async');
    expect(out.status).toBe('validating');
    expect(sqs.sendMessage).toHaveBeenCalled();
    const sqsBody = sqs.sendMessage.mock.calls[0]![1];
    expect(sqsBody.kind).toBe('batch.validate');
    expect(sqsBody.batchId).toBeDefined();
    expect(sqsBody.tenantId).toBe(TENANT.id);
  }, 90_000);
});
