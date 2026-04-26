import { randomUUID } from 'node:crypto';
import { TenantCtx } from '@common/decorators/tenant.decorator';
import { PrismaService } from '@common/prisma/prisma.service';
import { ENV_TOKEN } from '@config/config.module';
import type { Env } from '@config/env.schema';
import { S3Service } from '@infra/aws/s3.service';
import { SqsService } from '@infra/aws/sqs.service';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { buildBatchPreviewReadyEvent, buildInsuredCreatedEvent } from '../../events/insured-events';
import { type ConfirmBatchDto, type ListBatchErrorsQuery, type ListBatchesQuery } from './dto/batch.dto';
import { BatchesParserService } from './parser/batches-parser.service';
import { ParserError } from './parser/types';
import { BatchesValidatorService } from './validator/batches-validator.service';
import type { FieldError, RowResult, ValidationContext } from './validator/types';

const SYNC_THRESHOLD_ROWS = 1000;
const MAX_ROWS = 10_000;
const MAX_BYTES = 25 * 1024 * 1024;

export interface UploadResult {
  batchId: string;
  status: string;
  rowsTotal?: number;
  rowsOk?: number;
  rowsError?: number;
  /** Cuando el batch se procesa síncrono, el preview viene en la misma respuesta. */
  preview?: PreviewResponse;
  mode: 'sync' | 'async';
}

export interface PreviewResponse {
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  sample: {
    valid: Array<{ rowNumber: number; curp: string; packageId: string }>;
    errors: Array<{
      rowNumber: number;
      column: string | null;
      code: string;
      message: string;
      rawValue?: string;
      suggestions?: string[];
    }>;
  };
}

/**
 * Servicio de carga masiva.
 *
 * Flujo:
 *   1) `upload(file, tenant, userId)` → sube a S3, crea row `batches`,
 *      decide sync (≤1k filas) o async (>1k → encola en `layout-validation-queue`).
 *   2) Validación produce filas en `batch_errors` y un conteo agregado en `batches`.
 *   3) `confirm(id, dto)` encola N mensajes en `insureds-creation-queue` para
 *      que el worker cree los insureds.
 *
 * RLS: todas las queries pasan por `PrismaService` request-scoped — el tenant
 * se fija automáticamente. Los workers consumen mensajes de SQS con tenantId
 * explícito y deben usar `PrismaBypassRlsService` o crear un contexto manual.
 */
@Injectable()
export class BatchesService {
  private readonly log = new Logger(BatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly sqs: SqsService,
    private readonly parser: BatchesParserService,
    private readonly validator: BatchesValidatorService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  // ---------------------------------------------------------------------
  // upload
  // ---------------------------------------------------------------------
  async upload(
    file: { buffer: Buffer; filename: string; mimetype: string },
    tenant: TenantCtx,
    userId: string,
  ): Promise<UploadResult> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Archivo vacío');
    }
    if (file.buffer.length > MAX_BYTES) {
      throw new HttpException('Archivo demasiado grande (>25 MB)', HttpStatus.PAYLOAD_TOO_LARGE);
    }

    const batchId = randomUUID();
    const s3Key = `uploads/${tenant.id}/${batchId}/${this.sanitizeFileName(file.filename)}`;

    // 1) Subir a S3 LocalStack (KMS SSE).
    await this.s3.putObject({
      Bucket: this.env.S3_BUCKET_UPLOADS,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: this.env.KMS_KEY_ID,
      Metadata: {
        'tenant-id': tenant.id,
        'batch-id': batchId,
        'created-by': userId,
        'original-filename': file.filename,
      },
    });

    // 2) Crear row `batches` con status=validating.
    await this.prisma.client.batch.create({
      data: {
        id: batchId,
        tenantId: tenant.id,
        fileS3Key: s3Key,
        fileName: file.filename,
        status: 'validating',
        rowsTotal: 0,
        rowsOk: 0,
        rowsError: 0,
        createdBy: userId,
      },
    });

    // 3) Pre-parse rápido para contar filas y decidir sync vs async.
    let rowCount: number;
    try {
      const isXlsx = file.mimetype.includes('spreadsheetml');
      const rows = isXlsx ? await this.parser.parseXlsx(file.buffer) : this.parser.parseCsv(file.buffer);
      rowCount = rows.length;

      if (rowCount > MAX_ROWS) {
        await this.prisma.client.batch.update({
          where: { id: batchId },
          data: { status: 'failed' },
        });
        throw new HttpException(
          `Archivo excede el máximo de ${MAX_ROWS} filas (recibido ${rowCount})`,
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }

      // SÍNCRONO: filas ≤ 1k → validamos inline y devolvemos preview.
      if (rowCount <= SYNC_THRESHOLD_ROWS) {
        const ctx = await this.buildValidationContext(
          tenant.id,
          rows.map((r) => (r.raw.curp ?? '').toUpperCase()),
        );
        const results = this.validator.validateAll(rows, ctx);
        await this.persistResults(batchId, tenant.id, results);
        const counts = this.countResults(results);
        await this.prisma.client.batch.update({
          where: { id: batchId },
          data: {
            status: 'preview_ready',
            rowsTotal: counts.total,
            rowsOk: counts.ok,
            rowsError: counts.error,
            startedAt: new Date(),
          },
        });
        return {
          batchId,
          status: 'preview_ready',
          rowsTotal: counts.total,
          rowsOk: counts.ok,
          rowsError: counts.error,
          mode: 'sync',
          preview: this.buildPreview(results),
        };
      }

      // ASÍNCRONO: >1k filas → encolar para `LayoutWorkerService`.
      await this.sqs.sendMessage(this.env.SQS_QUEUE_LAYOUT, {
        kind: 'batch.validate',
        batchId,
        tenantId: tenant.id,
        s3Key,
        mimetype: file.mimetype,
      });
      return {
        batchId,
        status: 'validating',
        rowsTotal: rowCount,
        mode: 'async',
      };
    } catch (err) {
      // Errores de parser → batch failed + error visible al usuario.
      if (err instanceof ParserError) {
        await this.prisma.client.batch.update({
          where: { id: batchId },
          data: { status: 'failed' },
        });
        if (err.code === 'INVALID_ENCODING' || err.code === 'EMPTY_FILE' || err.code === 'NO_HEADER') {
          throw new BadRequestException(err.message);
        }
        if (err.code === 'UNSUPPORTED_FILE') {
          throw new HttpException(err.message, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        }
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // list / findOne / listErrors
  // ---------------------------------------------------------------------
  async list(
    q: ListBatchesQuery,
    _tenant: TenantCtx,
  ): Promise<{
    items: Array<{
      id: string;
      fileName: string;
      status: string;
      rowsTotal: number;
      rowsOk: number;
      rowsError: number;
      createdAt: Date;
    }>;
    nextCursor: string | null;
  }> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (q.status) where.status = q.status;
    const items = await this.prisma.client.batch.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        fileName: true,
        status: true,
        rowsTotal: true,
        rowsOk: true,
        rowsError: true,
        createdAt: true,
      },
    });
    const hasMore = items.length > q.limit;
    const trimmed = hasMore ? items.slice(0, q.limit) : items;
    const nextCursor = hasMore ? (trimmed[trimmed.length - 1]?.id ?? null) : null;
    return { items: trimmed, nextCursor };
  }

  async findOne(id: string, _tenant: TenantCtx): Promise<unknown> {
    const batch = await this.prisma.client.batch.findFirst({
      where: { id, deletedAt: null },
    });
    if (!batch) throw new NotFoundException('Batch no encontrado');
    return batch;
  }

  async listErrors(id: string, q: ListBatchErrorsQuery, _tenant: TenantCtx): Promise<unknown> {
    const batch = await this.prisma.client.batch.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!batch) throw new NotFoundException('Batch no encontrado');
    const items = await this.prisma.client.batchError.findMany({
      where: { batchId: id },
      orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > q.limit;
    const trimmed = hasMore ? items.slice(0, q.limit) : items;
    const nextCursor = hasMore ? (trimmed[trimmed.length - 1]?.id ?? null) : null;
    return { items: trimmed, nextCursor };
  }

  // ---------------------------------------------------------------------
  // preview
  // ---------------------------------------------------------------------
  async preview(id: string, _tenant: TenantCtx): Promise<PreviewResponse> {
    const batch = await this.prisma.client.batch.findFirst({
      where: { id, deletedAt: null },
    });
    if (!batch) throw new NotFoundException('Batch no encontrado');
    if (batch.status !== 'preview_ready') {
      throw new BadRequestException(
        `Batch en estado '${batch.status}'; preview sólo disponible en 'preview_ready'`,
      );
    }
    const errors = await this.prisma.client.batchError.findMany({
      where: { batchId: id },
      orderBy: [{ rowNumber: 'asc' }],
      take: 10,
    });
    // Sample valid: leemos hasta 10 filas válidas. No persistimos las válidas
    // intermedias (sólo el conteo agregado en batches), así que para el sample
    // lo dejamos vacío en el path async — el frontend ya puede mostrar el
    // total agregado. (En el path sync devolvemos un sample real desde el
    // upload response.)
    const duplicateRows = errors.filter(
      (e) => e.errorCode === 'DUPLICATED_IN_FILE' || e.errorCode === 'DUPLICATED_IN_TENANT',
    ).length;
    return {
      totalRows: batch.rowsTotal,
      validRows: batch.rowsOk,
      errorRows: batch.rowsError,
      duplicateRows,
      sample: {
        valid: [],
        errors: errors.map((e) => ({
          rowNumber: e.rowNumber,
          column: e.column,
          code: e.errorCode,
          message: e.errorMessage,
          rawValue: e.rawValue ?? undefined,
        })),
      },
    };
  }

  // ---------------------------------------------------------------------
  // errors xlsx export
  // ---------------------------------------------------------------------
  async errorsXlsx(id: string, _tenant: TenantCtx): Promise<{ filename: string; buffer: Buffer }> {
    const batch = await this.prisma.client.batch.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, fileName: true, status: true },
    });
    if (!batch) throw new NotFoundException('Batch no encontrado');
    const errors = await this.prisma.client.batchError.findMany({
      where: { batchId: id },
      orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }],
    });
    // Lazy-load exceljs para no inflar el bundle de cold start.
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.default.Workbook();
    const ws = wb.addWorksheet('Errores');
    ws.columns = [
      { header: 'Fila', key: 'rowNumber', width: 8 },
      { header: 'Columna', key: 'column', width: 24 },
      { header: 'Código', key: 'errorCode', width: 30 },
      { header: 'Mensaje', key: 'errorMessage', width: 60 },
      { header: 'Valor', key: 'rawValue', width: 30 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const e of errors) {
      ws.addRow({
        rowNumber: e.rowNumber,
        column: e.column ?? '',
        errorCode: e.errorCode,
        errorMessage: e.errorMessage,
        rawValue: e.rawValue ?? '',
      });
    }
    const out = await wb.xlsx.writeBuffer();
    const filename = `errores-${batch.fileName.replace(/\.[^.]+$/, '')}-${id.slice(0, 8)}.xlsx`;
    return { filename, buffer: Buffer.from(out as ArrayBuffer) };
  }

  // ---------------------------------------------------------------------
  // confirm / cancel
  // ---------------------------------------------------------------------
  async confirm(
    id: string,
    dto: ConfirmBatchDto,
    tenant: TenantCtx,
  ): Promise<{ queued: number; status: string; batchId: string }> {
    const batch = await this.prisma.client.batch.findFirst({
      where: { id, deletedAt: null },
    });
    if (!batch) throw new NotFoundException('Batch no encontrado');
    if (batch.status !== 'preview_ready') {
      throw new BadRequestException(
        `Batch en estado '${batch.status}'; confirm sólo disponible en 'preview_ready'`,
      );
    }
    if (batch.rowsOk <= 0) {
      throw new BadRequestException('Batch sin filas válidas para procesar');
    }

    // Re-parse + re-valida para obtener los DTOs (no persistimos las filas
    // válidas en el preview; la fuente de verdad sigue siendo el archivo S3).
    const buffer = await this.fetchS3Buffer(batch.fileS3Key);
    const isXlsx = batch.fileName.toLowerCase().endsWith('.xlsx');
    const rows = isXlsx ? await this.parser.parseXlsx(buffer) : this.parser.parseCsv(buffer);
    const ctx = await this.buildValidationContext(
      tenant.id,
      rows.map((r) => (r.raw.curp ?? '').toUpperCase()),
    );
    const results = this.validator.validateAll(rows, ctx);

    const allowed = dto.rowsToInclude && dto.rowsToInclude.length > 0 ? new Set(dto.rowsToInclude) : null;

    let queued = 0;
    for (const r of results) {
      if (!r.valid) continue;
      if (allowed && !allowed.has(r.rowNumber)) continue;
      await this.sqs.sendMessage(
        this.queueUrlForCreations(),
        {
          kind: 'insured.create',
          tenantId: tenant.id,
          batchId: id,
          rowNumber: r.rowNumber,
          dto: r.dto,
        },
        `${id}:${r.rowNumber}`, // dedupeId — defensa contra re-entregas en at-least-once.
      );
      queued += 1;
    }
    await this.prisma.client.batch.update({
      where: { id },
      data: { status: 'processing', startedAt: batch.startedAt ?? new Date() },
    });
    return { queued, status: 'processing', batchId: id };
  }

  async cancel(id: string, _tenant: TenantCtx): Promise<{ batchId: string; status: string }> {
    const batch = await this.prisma.client.batch.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!batch) throw new NotFoundException('Batch no encontrado');
    if (batch.status === 'completed' || batch.status === 'cancelled') {
      throw new BadRequestException(`Batch ya está en estado '${batch.status}'`);
    }
    await this.prisma.client.batch.update({
      where: { id },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    return { batchId: id, status: 'cancelled' };
  }

  // ---------------------------------------------------------------------
  // helpers internos
  // ---------------------------------------------------------------------

  private sanitizeFileName(name: string): string {
    return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 255);
  }

  private queueUrlForCreations(): string {
    // No tenemos cola dedicada en env (solo `SQS_QUEUE_LAYOUT`/`PDF`/...);
    // reusamos la `LAYOUT` con un `kind` distinto. El worker la separa por
    // `kind`. Cuando se agregue `SQS_QUEUE_INSUREDS_CREATION` al env schema,
    // reemplazar este getter.
    return this.env.SQS_QUEUE_LAYOUT.replace('layout-validation-queue', 'insureds-creation-queue');
  }

  private async fetchS3Buffer(s3Key: string): Promise<Buffer> {
    return this.s3.getObject(this.env.S3_BUCKET_UPLOADS, s3Key);
  }

  /**
   * Persiste los errores en `batch_errors` (idempotente: si ya hay errores
   * para el batch, los DELETE primero).
   */
  private async persistResults(batchId: string, tenantId: string, results: RowResult[]): Promise<void> {
    await this.prisma.client.batchError.deleteMany({ where: { batchId } });
    const rows: Array<{
      tenantId: string;
      batchId: string;
      rowNumber: number;
      column: string | null;
      errorCode: string;
      errorMessage: string;
      rawValue: string | null;
    }> = [];
    for (const r of results) {
      if (r.valid) continue;
      for (const e of r.errors) {
        rows.push({
          tenantId,
          batchId,
          rowNumber: r.rowNumber,
          column: e.column,
          errorCode: e.code,
          errorMessage: this.formatMessageWithSuggestions(e),
          rawValue: e.rawValue ?? null,
        });
      }
    }
    if (rows.length > 0) {
      await this.prisma.client.batchError.createMany({ data: rows });
    }
  }

  private formatMessageWithSuggestions(e: FieldError): string {
    if (e.code === 'PACKAGE_NOT_FOUND' && e.suggestions && e.suggestions.length > 0) {
      return `${e.message}. Sugerencias: ${e.suggestions.join(', ')}`;
    }
    return e.message;
  }

  private countResults(results: RowResult[]): { total: number; ok: number; error: number } {
    const ok = results.filter((r) => r.valid).length;
    return { total: results.length, ok, error: results.length - ok };
  }

  private buildPreview(results: RowResult[]): PreviewResponse {
    const validSample: PreviewResponse['sample']['valid'] = [];
    const errorSample: PreviewResponse['sample']['errors'] = [];
    let duplicateRows = 0;
    for (const r of results) {
      if (r.valid) {
        if (validSample.length < 10) {
          validSample.push({
            rowNumber: r.rowNumber,
            curp: r.dto.curp,
            packageId: r.dto.packageId,
          });
        }
      } else {
        const isDup = r.errors.some(
          (e) => e.code === 'DUPLICATED_IN_FILE' || e.code === 'DUPLICATED_IN_TENANT',
        );
        if (isDup) duplicateRows += 1;
        for (const e of r.errors) {
          if (errorSample.length < 10) {
            errorSample.push({
              rowNumber: r.rowNumber,
              column: e.column,
              code: e.code,
              message: e.message,
              rawValue: e.rawValue,
              suggestions: e.suggestions,
            });
          }
        }
      }
    }
    const counts = this.countResults(results);
    return {
      totalRows: counts.total,
      validRows: counts.ok,
      errorRows: counts.error,
      duplicateRows,
      sample: { valid: validSample, errors: errorSample },
    };
  }

  /**
   * Construye el `ValidationContext` haciendo 1 query al catálogo de paquetes
   * + 1 query a insureds activos cuyo CURP aparezca en el batch.
   */
  private async buildValidationContext(
    tenantId: string,
    curpsInBatch: readonly string[],
  ): Promise<ValidationContext> {
    const packages = await this.prisma.client.package.findMany({
      where: { deletedAt: null, status: 'active' },
      select: { id: true, name: true },
    });
    const uniqueCurps = Array.from(new Set(curpsInBatch.filter((c) => c.length === 18)));
    const existing =
      uniqueCurps.length > 0
        ? await this.prisma.client.insured.findMany({
            where: { curp: { in: uniqueCurps }, status: 'active', deletedAt: null },
            select: { id: true, curp: true, validTo: true },
          })
        : [];
    const existingActiveCurps = new Set(existing.map((i) => i.curp));
    const activeInsuredsByCurp = new Map<string, { validTo: Date; insuredId: string }>();
    for (const i of existing) {
      activeInsuredsByCurp.set(i.curp, { validTo: i.validTo, insuredId: i.id });
    }
    return { tenantId, packages, existingActiveCurps, activeInsuredsByCurp };
  }

  /**
   * Publica `batch.preview_ready` a EventBridge/SQS. Helper reutilizado por el
   * worker async — se exporta como método para que tests puedan mockearlo.
   */
  async publishPreviewReady(
    batchId: string,
    tenantId: string,
    totals: { rowsTotal: number; rowsOk: number; rowsError: number },
  ): Promise<void> {
    const event = buildBatchPreviewReadyEvent({ batchId, tenantId, ...totals });
    await this.sqs.sendMessage(
      this.env.SQS_QUEUE_LAYOUT,
      event as unknown as Record<string, unknown>,
      `${batchId}:preview_ready`,
    );
  }

  /**
   * Helper estático equivalente a `buildInsuredCreatedEvent` — re-exportado
   * desde aquí para que workers tengan un solo punto de import.
   */
  static buildInsuredCreatedEvent = buildInsuredCreatedEvent;
}
