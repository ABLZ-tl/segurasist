/**
 * S2-01 — Worker que consume `insureds-creation-queue` y crea filas
 * `insureds` + `beneficiaries`. Por cada insured creado emite un evento
 * `insured.created` que el agente B (Sprint 2 — PDF) consume.
 *
 * Cada mensaje SQS lleva:
 *   {
 *     kind: 'insured.create',
 *     tenantId, batchId, rowNumber,
 *     dto: CreateInsuredDto
 *   }
 *
 * Idempotencia: la unicidad (tenantId, curp) en la tabla `insureds` la
 * garantiza el unique compuesto. Si un mensaje se re-entrega después de
 * que la fila ya se creó, atrapamos `P2002` (unique violation) y lo
 * tratamos como éxito.
 *
 * Conteos del batch (post Sprint 4 fix C-06/C-07/C-08):
 *   - `processed_rows` aumenta por cada mensaje consumido.
 *   - `success_rows` aumenta sólo si la inserción fue exitosa (incluyendo
 *     re-entrega que ya estaba persistida).
 *   - `failed_rows` aumenta si el handler falló por causa NO recuperable.
 *   - `rows_ok / rows_error` NO se tocan acá — son counters de la fase de
 *     VALIDATION (LayoutWorker / sync upload).
 *
 * Cuando `processed_rows >= queued_count` (el target real del confirm; puede
 * ser un subset de rows_ok si se usó `rowsToInclude`) → batch `completed` +
 * evento `batch.completed` exactly-once vía compare-and-set sobre
 * `completed_event_emitted_at`.
 */
import { SQSClient } from '@aws-sdk/client-sqs';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { ENV_TOKEN } from '@config/config.module';
import type { Env } from '@config/env.schema';
import { SqsService } from '@infra/aws/sqs.service';
import type { CreateInsuredDto } from '@modules/insureds/dto/insured.dto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildBatchCompletedEvent as buildBatchCompletedEventImported,
  buildInsuredCreatedEvent,
} from '../events/insured-events';
import { SqsPoller, type SqsHandler } from './sqs-poller';

interface InsuredCreateMessage {
  kind: 'insured.create';
  tenantId: string;
  batchId: string;
  rowNumber: number;
  dto: CreateInsuredDto;
}

@Injectable()
export class InsuredsCreationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(InsuredsCreationWorkerService.name);
  private poller: SqsPoller | null = null;
  private readonly enabled: boolean;
  private readonly queueUrl: string;

  constructor(
    private readonly prismaBypass: PrismaBypassRlsService,
    private readonly sqs: SqsService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.enabled = (process.env.WORKERS_ENABLED ?? 'false') === 'true';
    this.queueUrl = env.SQS_QUEUE_INSUREDS_CREATION;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.log.log('InsuredsCreationWorker deshabilitado (WORKERS_ENABLED!=true)');
      return;
    }
    if (!this.prismaBypass.isEnabled()) {
      this.log.warn('InsuredsCreationWorker requiere DATABASE_URL_BYPASS — deshabilitado');
      return;
    }
    const client = new SQSClient({
      region: this.env.AWS_REGION,
      ...(this.env.AWS_ENDPOINT_URL ? { endpoint: this.env.AWS_ENDPOINT_URL } : {}),
    });
    this.poller = new SqsPoller(
      client,
      { queueUrl: this.queueUrl, waitTimeSeconds: 5 },
      this.handleMessage as SqsHandler,
      'InsuredsCreationWorker',
    );
    this.poller.start();
    this.log.log({ queueUrl: this.queueUrl }, 'InsuredsCreationWorker iniciado');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.poller) {
      await this.poller.stop();
    }
  }

  private readonly handleMessage = async (body: unknown): Promise<void> => {
    if (!isInsuredCreateMessage(body)) {
      return;
    }
    await this.processMessage(body);
  };

  /**
   * Procesa un mensaje de creación. Expuesto público para tests.
   */
  async processMessage(msg: InsuredCreateMessage): Promise<void> {
    const { tenantId, batchId, rowNumber, dto } = msg;
    let success = false;
    let createdInsuredId: string | null = null;
    try {
      const created = await this.createInsuredWithBeneficiaries(tenantId, dto);
      createdInsuredId = created.id;
      success = true;
      this.log.log({ batchId, rowNumber, insuredId: created.id }, 'insured creado');
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Unique violation → la fila ya existe (re-entrega). Buscamos el id
        // existente para emitir el evento (defensivo: el agente B
        // sigue esperando insured.created).
        const existing = await this.prismaBypass.client.insured.findFirst({
          where: { tenantId, curp: dto.curp.toUpperCase(), deletedAt: null },
          select: { id: true },
        });
        createdInsuredId = existing?.id ?? null;
        success = createdInsuredId !== null;
        this.log.warn({ batchId, rowNumber, curp: dto.curp }, 'insured ya existía (idempotente)');
      } else {
        this.log.error({ err, batchId, rowNumber }, 'creación de insured falló');
        success = false;
      }
    }

    // Emitir evento + actualizar contadores.
    if (success && createdInsuredId) {
      const event = buildInsuredCreatedEvent({
        tenantId,
        insuredId: createdInsuredId,
        packageId: dto.packageId,
        batchId,
        rowNumber,
      });
      // C-09: dedupeId removido — la cola PDF es standard. Idempotencia del
      // PDF generator se cubre DB-side via UNIQUE `(tenant_id, insured_id,
      // version)` en `certificates` (F1 owner del worker downstream).
      await this.sqs.sendMessage(this.env.SQS_QUEUE_PDF, event as unknown as Record<string, unknown>);
    }

    await this.bumpBatchCounters(batchId, tenantId, success);
  }

  /**
   * Inserta `insured` + `beneficiaries` en transacción para garantizar
   * atomicidad.
   */
  private async createInsuredWithBeneficiaries(
    tenantId: string,
    dto: CreateInsuredDto,
  ): Promise<{ id: string }> {
    return this.prismaBypass.client.$transaction(async (tx) => {
      const created = await tx.insured.create({
        data: {
          tenantId,
          curp: dto.curp.toUpperCase(),
          ...(dto.rfc ? { rfc: dto.rfc.toUpperCase() } : {}),
          fullName: dto.fullName,
          dob: new Date(`${dto.dob}T00:00:00Z`),
          ...(dto.email ? { email: dto.email } : {}),
          ...(dto.phone ? { phone: dto.phone } : {}),
          packageId: dto.packageId,
          validFrom: new Date(`${dto.validFrom}T00:00:00Z`),
          validTo: new Date(`${dto.validTo}T00:00:00Z`),
          status: 'active',
        },
        select: { id: true },
      });
      if (dto.beneficiaries && dto.beneficiaries.length > 0) {
        await tx.beneficiary.createMany({
          data: dto.beneficiaries.map((b) => ({
            tenantId,
            insuredId: created.id,
            fullName: b.fullName,
            relationship: b.relationship,
            dob: new Date(`${b.dob}T00:00:00Z`),
            ...(b.curp ? { curp: b.curp.toUpperCase() } : {}),
          })),
        });
      }
      return created;
    });
  }

  /**
   * Incrementa contadores del batch atómicamente y, si todas las filas
   * encoladas en `confirm()` ya fueron procesadas, transiciona el batch a
   * `completed` y emite `batch.completed` exactly-once.
   *
   * Diseño (post fix C-06/C-07/C-08):
   *
   *   1. Un sólo `UPDATE ... RETURNING` incrementa
   *      `processed_rows / success_rows / failed_rows` y devuelve la fila
   *      completa. NO tocamos `rows_ok / rows_error` (esos son counters de
   *      la fase validación, owned por LayoutWorker / sync upload).
   *   2. Si después del UPDATE el batch está listo para completarse
   *      (`processed_rows >= queued_count` y status=`processing`), se intenta
   *      una transición atómica:
   *
   *        UPDATE batches
   *           SET status='completed',
   *               completed_at=NOW(),
   *               completed_event_emitted_at=NOW()
   *         WHERE id=:id
   *           AND status='processing'
   *           AND completed_event_emitted_at IS NULL
   *           AND processed_rows >= queued_count
   *
   *      Si esta UPDATE actualiza 0 filas, otro worker concurrente ya
   *      completó el batch — silenciamos y NO emitimos. Si actualiza 1 fila,
   *      somos los winners y emitimos el evento.
   *
   *   3. El UNIQUE PARTIAL INDEX
   *      `idx_batches_completed_once ON batches(id) WHERE
   *      completed_event_emitted_at IS NOT NULL` es backup defensivo: si por
   *      algún bug futuro la guard `completed_event_emitted_at IS NULL` se
   *      bypaseara, Postgres rechazaría la 2da inserción.
   */
  private async bumpBatchCounters(batchId: string, tenantId: string, success: boolean): Promise<void> {
    // 1) Incremento atómico de processed/success/failed. RETURNING devuelve la
    //    fila post-update para evitar el read-after-write en una segunda query
    //    (que reintroduciría el TOCTOU).
    type BatchRow = {
      id: string;
      status: string;
      rows_total: number;
      rows_ok: number;
      rows_error: number;
      processed_rows: number;
      success_rows: number;
      failed_rows: number;
      queued_count: number | null;
      completed_event_emitted_at: Date | null;
    };
    const updated = await this.prismaBypass.client.$queryRaw<BatchRow[]>`
      UPDATE batches
         SET processed_rows = processed_rows + 1,
             success_rows   = success_rows + ${success ? 1 : 0},
             failed_rows    = failed_rows + ${success ? 0 : 1},
             updated_at     = NOW()
       WHERE id = ${batchId}::uuid AND tenant_id = ${tenantId}::uuid
   RETURNING id, status::text AS status, rows_total, rows_ok, rows_error,
             processed_rows, success_rows, failed_rows, queued_count,
             completed_event_emitted_at
    `;
    const batch = updated[0];
    if (!batch) {
      this.log.warn({ batchId, tenantId }, 'bumpBatchCounters: batch no encontrado');
      return;
    }

    // 2) ¿Está listo para completarse? Comparamos contra `queued_count` (el
    //    target real del confirm), NO contra `rows_total`. Si queued_count es
    //    NULL (legacy/migración) caemos a rows_ok como fallback razonable.
    const target = batch.queued_count ?? batch.rows_ok;
    if (
      batch.status !== 'processing' ||
      batch.completed_event_emitted_at !== null ||
      batch.processed_rows < target ||
      target <= 0
    ) {
      return;
    }

    // 3) Compare-and-set: sólo el primer caller que ve la condición ganará.
    //    El UPDATE con guard `completed_event_emitted_at IS NULL` y
    //    `processed_rows >= queued_count` retorna 0 filas si otro worker
    //    nos ganó la carrera.
    const claimed = await this.prismaBypass.client.$queryRaw<Array<{ id: string }>>`
      UPDATE batches
         SET status = 'completed'::batch_status,
             completed_at = NOW(),
             completed_event_emitted_at = NOW(),
             updated_at = NOW()
       WHERE id = ${batchId}::uuid
         AND tenant_id = ${tenantId}::uuid
         AND status = 'processing'::batch_status
         AND completed_event_emitted_at IS NULL
         AND processed_rows >= COALESCE(queued_count, rows_ok)
         AND COALESCE(queued_count, rows_ok) > 0
   RETURNING id
    `;
    if (claimed.length === 0) {
      // Otro worker concurrente ya emitió el evento — exactly-once preservado.
      this.log.log({ batchId }, 'batch ya completado por otro worker (race lost)');
      return;
    }

    // Ganamos la carrera; emitimos el evento. `rowsOk/rowsError` se reportan
    // como totales de PROCESSING (success_rows / failed_rows), no como los
    // counters de validación, que son una métrica distinta.
    const event = buildBatchCompletedEventImported({
      batchId,
      tenantId,
      rowsTotal: batch.rows_total,
      rowsOk: batch.success_rows,
      rowsError: batch.failed_rows,
    });
    // C-09: dedupeId removido — exactly-once ya está garantizado por el CAS
    // sobre `completed_event_emitted_at` arriba (UPDATE devuelve 0 filas si
    // otro worker ganó la carrera). MessageDeduplicationId era redundante y
    // se ignoraba en cola standard.
    await this.sqs.sendMessage(this.env.SQS_QUEUE_LAYOUT, event as unknown as Record<string, unknown>);
    this.log.log(
      { batchId, processed: batch.processed_rows, target },
      'batch completado (exactly-once)',
    );
  }
}

function isInsuredCreateMessage(body: unknown): body is InsuredCreateMessage {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    b.kind === 'insured.create' &&
    typeof b.tenantId === 'string' &&
    typeof b.batchId === 'string' &&
    typeof b.rowNumber === 'number' &&
    typeof b.dto === 'object' &&
    b.dto !== null
  );
}
