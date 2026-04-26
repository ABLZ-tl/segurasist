/**
 * S2-01 — Worker que valida lotes asíncronos.
 *
 * Patrón "lambda-like" para dev local: NestJS no soporta Lambda nativo,
 * así que un servicio singleton hace `pollSqsLayoutQueue` cada 5s. En
 * producción este código es trivial de portear a Lambda — el handler ya es
 * `processMessage(body)` puro.
 *
 * Responsabilidades:
 *  1) Pollea `SQS_QUEUE_LAYOUT` (mensajes con `kind=batch.validate`).
 *  2) Por cada mensaje: descarga S3, parsea, valida en chunks de 500 filas
 *     (no bloquear event loop), persiste `batch_errors`, actualiza counts.
 *  3) Marca el batch como `preview_ready` y publica `batch.preview_ready`.
 *
 * Idempotencia: si ya hay `batch_errors` para ese batch, los DELETE primero.
 * Esto cubre re-procesamiento por re-entrega SQS.
 *
 * Manejo de errores:
 *  - Fila individual con `PARSE_ERROR` → entra a `batch_errors`, el batch
 *    sigue.
 *  - Archivo entero falla parsing → batch `failed` + log alert.
 */
import { SQSClient } from '@aws-sdk/client-sqs';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { ENV_TOKEN } from '@config/config.module';
import type { Env } from '@config/env.schema';
import { S3Service } from '@infra/aws/s3.service';
import { SqsService } from '@infra/aws/sqs.service';
import { BatchesParserService } from '@modules/batches/parser/batches-parser.service';
import { ParserError } from '@modules/batches/parser/types';
import { BatchesValidatorService } from '@modules/batches/validator/batches-validator.service';
import type { RowResult, ValidationContext } from '@modules/batches/validator/types';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildBatchPreviewReadyEvent } from '../events/insured-events';
import { SqsPoller, type SqsHandler } from './sqs-poller';

const VALIDATION_CHUNK_SIZE = 500;
const PROGRESS_UPDATE_INTERVAL = 1000;

interface LayoutValidateMessage {
  kind: 'batch.validate';
  batchId: string;
  tenantId: string;
  s3Key: string;
  mimetype: string;
}

@Injectable()
export class LayoutWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(LayoutWorkerService.name);
  private poller: SqsPoller | null = null;
  /**
   * Habilitar/deshabilitar el poller. En tests, e2e o cuando la cola no
   * existe (LocalStack down), preferimos que el módulo Nest levante sin
   * que este worker spamee logs. Override por env `WORKERS_ENABLED=false`.
   */
  private readonly enabled: boolean;

  constructor(
    private readonly prismaBypass: PrismaBypassRlsService,
    private readonly s3: S3Service,
    private readonly sqs: SqsService,
    private readonly parser: BatchesParserService,
    private readonly validator: BatchesValidatorService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.enabled = (process.env.WORKERS_ENABLED ?? 'false') === 'true';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.log.log('LayoutWorker deshabilitado (WORKERS_ENABLED!=true)');
      return;
    }
    if (!this.prismaBypass.isEnabled()) {
      this.log.warn('LayoutWorker requiere DATABASE_URL_BYPASS — deshabilitado');
      return;
    }
    const client = new SQSClient({
      region: this.env.AWS_REGION,
      ...(this.env.AWS_ENDPOINT_URL ? { endpoint: this.env.AWS_ENDPOINT_URL } : {}),
    });
    this.poller = new SqsPoller(
      client,
      { queueUrl: this.env.SQS_QUEUE_LAYOUT, waitTimeSeconds: 5 },
      this.handleMessage as SqsHandler,
      'LayoutWorker',
    );
    this.poller.start();
    this.log.log('LayoutWorker iniciado, poll cada 5s');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.poller) {
      await this.poller.stop();
    }
  }

  /**
   * Handler arrow para preservar `this`.
   */
  private readonly handleMessage = async (body: unknown): Promise<void> => {
    if (!isLayoutValidateMessage(body)) {
      // Otros tipos de mensajes en la misma cola (e.g. `batch.preview_ready`
      // que se publica como evento) — los ignoramos.
      return;
    }
    await this.processBatch(body);
  };

  /**
   * Procesa un mensaje. Expuesto público para que tests lo invoquen sin SQS.
   */
  async processBatch(msg: LayoutValidateMessage): Promise<void> {
    const { batchId, tenantId, s3Key } = msg;
    this.log.log({ batchId, tenantId }, 'iniciando validación async');

    try {
      const buffer = await this.s3.getObject(this.env.S3_BUCKET_UPLOADS, s3Key);
      const isXlsx = msg.mimetype.includes('spreadsheetml');
      const rows = isXlsx ? await this.parser.parseXlsx(buffer) : this.parser.parseCsv(buffer);

      // Idempotencia: borrar errores previos antes de re-procesar.
      await this.prismaBypass.client.batchError.deleteMany({ where: { batchId } });

      const ctx = await this.buildContext(
        tenantId,
        rows.map((r) => (r.raw.curp ?? '').toUpperCase()),
      );

      let processed = 0;
      let okCount = 0;
      let errorCount = 0;
      const allResults: RowResult[] = [];

      for (let i = 0; i < rows.length; i += VALIDATION_CHUNK_SIZE) {
        const slice = rows.slice(i, i + VALIDATION_CHUNK_SIZE);
        const chunkResults = this.validator.validateAll(slice, ctx);
        allResults.push(...chunkResults);
        for (const r of chunkResults) {
          if (r.valid) okCount += 1;
          else errorCount += 1;
        }
        await this.persistChunkErrors(batchId, tenantId, chunkResults);
        processed += slice.length;
        if (processed % PROGRESS_UPDATE_INTERVAL === 0 || processed === rows.length) {
          await this.prismaBypass.client.batch.update({
            where: { id: batchId },
            data: { rowsTotal: processed, rowsOk: okCount, rowsError: errorCount },
          });
        }
        // Yield al event loop entre chunks para no bloquear.
        await new Promise((r) => setImmediate(r));
      }

      await this.prismaBypass.client.batch.update({
        where: { id: batchId },
        data: {
          status: 'preview_ready',
          rowsTotal: rows.length,
          rowsOk: okCount,
          rowsError: errorCount,
          startedAt: new Date(),
        },
      });
      const event = buildBatchPreviewReadyEvent({
        batchId,
        tenantId,
        rowsTotal: rows.length,
        rowsOk: okCount,
        rowsError: errorCount,
      });
      await this.sqs.sendMessage(
        this.env.SQS_QUEUE_LAYOUT,
        event as unknown as Record<string, unknown>,
        `${batchId}:preview_ready`,
      );
      this.log.log({ batchId, ok: okCount, error: errorCount }, 'preview_ready emitido');
    } catch (err) {
      this.log.error({ err, batchId, tenantId }, 'fallo procesamiento batch');
      // Si es ParserError → archivo entero inválido, fila por fila imposible.
      if (err instanceof ParserError) {
        await this.prismaBypass.client.batchError.create({
          data: {
            tenantId,
            batchId,
            rowNumber: 0,
            column: null,
            errorCode: 'PARSE_ERROR',
            errorMessage: err.message,
            rawValue: null,
          },
        });
      }
      await this.prismaBypass.client.batch.update({
        where: { id: batchId },
        data: { status: 'failed', completedAt: new Date() },
      });
    }
  }

  private async buildContext(tenantId: string, curpsInBatch: readonly string[]): Promise<ValidationContext> {
    // Worker usa BYPASSRLS — debe filtrar manualmente por tenantId.
    const packages = await this.prismaBypass.client.package.findMany({
      where: { tenantId, deletedAt: null, status: 'active' },
      select: { id: true, name: true },
    });
    const uniqueCurps = Array.from(new Set(curpsInBatch.filter((c) => c.length === 18)));
    const existing =
      uniqueCurps.length > 0
        ? await this.prismaBypass.client.insured.findMany({
            where: { tenantId, curp: { in: uniqueCurps }, status: 'active', deletedAt: null },
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

  private async persistChunkErrors(
    batchId: string,
    tenantId: string,
    results: readonly RowResult[],
  ): Promise<void> {
    const rows: Prisma.BatchErrorCreateManyInput[] = [];
    for (const r of results) {
      if (r.valid) continue;
      for (const e of r.errors) {
        const message =
          e.code === 'PACKAGE_NOT_FOUND' && e.suggestions && e.suggestions.length > 0
            ? `${e.message}. Sugerencias: ${e.suggestions.join(', ')}`
            : e.message;
        rows.push({
          tenantId,
          batchId,
          rowNumber: r.rowNumber,
          column: e.column,
          errorCode: e.code,
          errorMessage: message,
          rawValue: e.rawValue ?? null,
        });
      }
    }
    if (rows.length > 0) {
      await this.prismaBypass.client.batchError.createMany({ data: rows });
    }
  }
}

function isLayoutValidateMessage(body: unknown): body is LayoutValidateMessage {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    b.kind === 'batch.validate' &&
    typeof b.batchId === 'string' &&
    typeof b.tenantId === 'string' &&
    typeof b.s3Key === 'string'
  );
}
