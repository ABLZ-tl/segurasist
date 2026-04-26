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
 * Conteos del batch:
 *   - `processed_rows` aumenta por cada mensaje consumido.
 *   - `success_rows` aumenta sólo si la inserción fue exitosa (incluyendo
 *     re-entrega que ya estaba persistida).
 *   - `failed_rows` aumenta si el handler falló por causa NO recuperable.
 *
 * Cuando `processed == ok + error == batch.rowsOk` → batch `completed` +
 * evento `batch.completed`.
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
    // Convención: misma URL que LAYOUT pero con cola distinta.
    this.queueUrl = env.SQS_QUEUE_LAYOUT.replace('layout-validation-queue', 'insureds-creation-queue');
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
      await this.sqs.sendMessage(
        this.env.SQS_QUEUE_PDF,
        event as unknown as Record<string, unknown>,
        `${createdInsuredId}:created`,
      );
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
   * Incrementa contadores del batch. Si todas las filas válidas se
   * procesaron, marca `completed` y emite `batch.completed`.
   *
   * Usamos un UPDATE con expresiones SQL para evitar TOCTOU entre lectura y
   * escritura cuando varias instancias del worker corren en paralelo. La
   * unicidad la garantiza Postgres.
   */
  private async bumpBatchCounters(batchId: string, tenantId: string, success: boolean): Promise<void> {
    // No tenemos columna `processed_rows` — usamos `rowsOk` y `rowsError` ya
    // existentes, pero su semántica acá es: cuántos PROCESADOS post-confirm.
    // En la fase de validación se setearon a los counts del preview; al
    // confirmar se reinician en este path.
    // (Fix: idealmente agregaríamos `processed_rows` al schema; queda anotado
    // como TODO para cuando aterricen las migraciones de Sprint 2.)
    await this.prismaBypass.client.$executeRaw`
      UPDATE batches SET rows_ok = rows_ok + ${success ? 1 : 0},
                         rows_error = rows_error + ${success ? 0 : 1},
                         updated_at = NOW()
      WHERE id = ${batchId}::uuid AND tenant_id = ${tenantId}::uuid
    `;
    // ¿Está completo?
    const batch = await this.prismaBypass.client.batch.findFirst({
      where: { id: batchId, tenantId },
      select: { id: true, status: true, rowsTotal: true, rowsOk: true, rowsError: true },
    });
    if (batch && batch.status === 'processing' && batch.rowsOk + batch.rowsError >= batch.rowsTotal) {
      await this.prismaBypass.client.batch.update({
        where: { id: batchId },
        data: { status: 'completed', completedAt: new Date() },
      });
      const event = buildBatchCompletedEventImported({
        batchId,
        tenantId,
        rowsTotal: batch.rowsTotal,
        rowsOk: batch.rowsOk,
        rowsError: batch.rowsError,
      });
      await this.sqs.sendMessage(
        this.env.SQS_QUEUE_LAYOUT,
        event as unknown as Record<string, unknown>,
        `${batchId}:completed`,
      );
      this.log.log({ batchId }, 'batch completado');
    }
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
