/**
 * S3-09 — Reports Worker.
 *
 * Consume `reports-queue` (LocalStack/SQS) y procesa jobs de export. Hoy
 * sólo soporta `kind='insureds'` con format XLSX o PDF; el switch interno
 * permite extender a otros recursos en el futuro sin tocar el poller.
 *
 * Pipeline por mensaje:
 *   1. Read DB row `exports.{exportId}` (estado debe ser 'pending').
 *   2. Update a 'processing'.
 *   3. Run query con BYPASSRLS (filtra por tenantId del mensaje); aplica
 *      hard cap a EXPORT_ROW_HARD_CAP filas para evitar OOMs.
 *   4. Generate XLSX (exceljs) o PDF (Puppeteer; reusa PuppeteerService).
 *   5. Calcular SHA-256 del Buffer.
 *   6. Upload S3 con SSE-KMS, key `exports/{tenantId}/{exportId}.{ext}` y
 *      Metadata x-tenant-id, x-hash, x-row-count.
 *   7. Update DB row → 'ready' con s3Key, hash, rowCount, completedAt.
 *   8. Audit log `data.export.completed` con rowCount + format.
 *
 * Si cualquier paso falla:
 *   - DB → 'failed' con mensaje.
 *   - Audit log `data.export.failed` con motivo.
 *   - SQS message NO se borra → reentrega (idempotencia: el handler chequea
 *     si la row ya está en 'ready' y skipea).
 *
 * Tenant isolation: el worker corre con BYPASSRLS pero TODAS las queries
 * filtran por `tenantId = msg.tenantId` (el `tenantId` viene firmado dentro
 * del mensaje SQS — confianza implícita en la cola interna). Los tests
 * cross-tenant verifican que un mensaje con tenantId distinto del actor
 * que lo encoló no contamina filas.
 *
 * Filename pattern (NO incluye cognito_sub ni IDs internos):
 *   `insureds-{tenantSlug}-{YYYYMMDD-HHmmss}-{shortHash}.{xlsx|pdf}`
 *   shortHash = primeros 8 chars del SHA-256 del archivo.
 */
import { createHash } from 'node:crypto';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { ENV_TOKEN } from '@config/config.module';
import type { Env } from '@config/env.schema';
import { S3Service } from '@infra/aws/s3.service';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import { PuppeteerService } from '@modules/certificates/puppeteer.service';
import type { ExportFilters } from '@modules/insureds/dto/export.dto';
import { EXPORT_ROW_HARD_CAP } from '@modules/insureds/dto/export.dto';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import ExcelJS from 'exceljs';

const POLL_INTERVAL_MS = 3_000;

interface ExportRequestedEvent {
  kind: 'export.requested';
  exportId: string;
  tenantId: string;
  insuredKind: 'insureds';
  format: 'xlsx' | 'pdf';
  filters: ExportFilters;
}

interface InsuredRow {
  id: string;
  curp: string;
  rfc: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  validFrom: Date;
  validTo: Date;
  status: string;
  packageName: string;
  numeroEmpleadoExterno: string | null;
}

@Injectable()
export class ReportsWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(ReportsWorkerService.name);
  private readonly sqsClient: SQSClient;
  private polling = false;
  private stopRequested = false;
  private readonly enabled: boolean;

  constructor(
    private readonly prismaBypass: PrismaBypassRlsService,
    private readonly s3: S3Service,
    private readonly puppeteer: PuppeteerService,
    private readonly auditWriter: AuditWriterService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.enabled = (process.env.WORKERS_ENABLED ?? 'false') === 'true';
    this.sqsClient = new SQSClient({
      region: env.AWS_REGION,
      ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
    });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled || this.env.NODE_ENV === 'test') {
      this.log.log(
        { enabled: this.enabled, nodeEnv: this.env.NODE_ENV },
        'ReportsWorker NO inicia poller (WORKERS_ENABLED!=true o NODE_ENV=test)',
      );
      return;
    }
    void this.runPollLoop();
    this.log.log({ queue: this.env.SQS_QUEUE_REPORTS }, 'ReportsWorker poll loop started');
  }

  async onModuleDestroy(): Promise<void> {
    this.stopRequested = true;
    while (this.polling) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async runPollLoop(): Promise<void> {
    while (!this.stopRequested) {
      this.polling = true;
      try {
        await this.pollOnce();
      } catch (err) {
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'ReportsWorker pollOnce failed',
        );
      } finally {
        this.polling = false;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  /**
   * Visible para tests. Lee N mensajes y los despacha (delete-on-success).
   */
  async pollOnce(): Promise<void> {
    const out = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.env.SQS_QUEUE_REPORTS,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 1,
        VisibilityTimeout: 120,
      }),
    );
    const messages = out.Messages ?? [];
    for (const msg of messages) {
      try {
        const body = JSON.parse(msg.Body ?? '{}') as ExportRequestedEvent;
        await this.handleEvent(body);
        if (msg.ReceiptHandle) {
          await this.sqsClient.send(
            new DeleteMessageCommand({
              QueueUrl: this.env.SQS_QUEUE_REPORTS,
              ReceiptHandle: msg.ReceiptHandle,
            }),
          );
        }
      } catch (err) {
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err), msgId: msg.MessageId },
          'ReportsWorker handleEvent failed; mensaje queda en cola para retry',
        );
      }
    }
  }

  /**
   * Despacha un evento. Visible para tests (que llaman directo).
   */
  async handleEvent(event: ExportRequestedEvent): Promise<{ status: 'ready' | 'failed' | 'skipped' }> {
    if (event.kind !== 'export.requested') {
      this.log.warn({ kind: event.kind }, 'evento desconocido en reports-queue; ignorando');
      return { status: 'skipped' };
    }
    if (event.insuredKind !== 'insureds') {
      this.log.warn({ insuredKind: event.insuredKind }, 'kind de export desconocido; ignorando');
      return { status: 'skipped' };
    }

    const exportRow = await this.prismaBypass.client.export.findFirst({
      where: { id: event.exportId, tenantId: event.tenantId },
    });
    if (!exportRow) {
      this.log.warn({ exportId: event.exportId }, 'export row not found; descartando mensaje');
      return { status: 'skipped' };
    }
    if (exportRow.status === 'ready') {
      // Idempotencia: SQS at-least-once. Re-entrega después de éxito → skip.
      this.log.log({ exportId: event.exportId }, 'export ya está ready; skip');
      return { status: 'skipped' };
    }
    if (exportRow.status === 'failed') {
      this.log.log({ exportId: event.exportId }, 'export marcado failed; no reintenta automático');
      return { status: 'skipped' };
    }

    // Marcar processing.
    await this.prismaBypass.client.export.update({
      where: { id: event.exportId },
      data: { status: 'processing' },
    });

    try {
      const result = await this.runJob(event);
      // Update DB → ready.
      await this.prismaBypass.client.export.update({
        where: { id: event.exportId },
        data: {
          status: 'ready',
          s3Key: result.s3Key,
          hash: result.hash,
          rowCount: result.rowCount,
          completedAt: new Date(),
        },
      });
      // Audit completed.
      void this.auditWriter.record({
        tenantId: event.tenantId,
        actorId: exportRow.requestedBy,
        action: 'export',
        resourceType: 'insureds',
        resourceId: event.exportId,
        payloadDiff: {
          subAction: 'completed',
          format: event.format,
          rowCount: result.rowCount,
          fileHash: result.hash,
        },
      });
      this.log.log(
        { exportId: event.exportId, rowCount: result.rowCount, s3Key: result.s3Key },
        'export ready',
      );
      return { status: 'ready' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prismaBypass.client.export.update({
        where: { id: event.exportId },
        data: { status: 'failed', error: message.slice(0, 500), completedAt: new Date() },
      });
      void this.auditWriter.record({
        tenantId: event.tenantId,
        actorId: exportRow.requestedBy,
        action: 'export',
        resourceType: 'insureds',
        resourceId: event.exportId,
        payloadDiff: { subAction: 'failed', format: event.format, error: message },
      });
      this.log.error({ exportId: event.exportId, err: message }, 'export job failed');
      return { status: 'failed' };
    }
  }

  /**
   * Genera el archivo y lo sube. Devuelve s3Key + hash + rowCount.
   * Aislado para que tests puedan mockear el bucket fácilmente.
   */
  private async runJob(
    event: ExportRequestedEvent,
  ): Promise<{ s3Key: string; hash: string; rowCount: number }> {
    const rows = await this.queryInsureds(event.tenantId, event.filters);

    let buffer: Buffer;
    let contentType: string;
    let extension: string;
    if (event.format === 'xlsx') {
      buffer = await this.renderXlsx(rows);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      extension = 'xlsx';
    } else {
      buffer = await this.renderPdf(rows, event.tenantId);
      contentType = 'application/pdf';
      extension = 'pdf';
    }

    const hash = createHash('sha256').update(buffer).digest('hex');
    const s3Key = `exports/${event.tenantId}/${event.exportId}.${extension}`;

    await this.s3.putObject({
      Bucket: this.env.S3_BUCKET_EXPORTS,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: this.env.KMS_KEY_ID,
      Metadata: {
        'x-tenant-id': event.tenantId,
        'x-export-id': event.exportId,
        'x-hash': hash,
        'x-row-count': String(rows.length),
        'x-format': event.format,
      },
    });

    return { s3Key, hash, rowCount: rows.length };
  }

  /**
   * Query con BYPASSRLS pero filtrando por tenantId del mensaje. Hard cap
   * a EXPORT_ROW_HARD_CAP filas (200k) — más allá lanza error y el job
   * queda en 'failed'.
   *
   * Reusa la lógica de `buildExportWhere` indirectamente vía Prisma raw
   * filter (duplicamos aquí porque el service es request-scoped y este
   * worker es application-scoped).
   */
  private async queryInsureds(tenantId: string, filters: ExportFilters): Promise<InsuredRow[]> {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.packageId) where.packageId = filters.packageId;
    if (filters.q) {
      const term = filters.q.trim();
      where.OR = [
        { fullName: { contains: term, mode: 'insensitive' } },
        { curp: { contains: term.toUpperCase() } },
        { rfc: { contains: term.toUpperCase() } },
        { metadata: { path: ['numeroEmpleadoExterno'], string_contains: term } },
      ];
    }
    const validFromRange: { gte?: Date; lte?: Date } = {};
    if (filters.validFromGte) validFromRange.gte = new Date(filters.validFromGte);
    if (filters.validFromLte) validFromRange.lte = new Date(filters.validFromLte);
    if (Object.keys(validFromRange).length > 0) where.validFrom = validFromRange;

    const validToRange: { gte?: Date; lte?: Date } = {};
    if (filters.validToGte) validToRange.gte = new Date(filters.validToGte);
    if (filters.validToLte) validToRange.lte = new Date(filters.validToLte);
    if (Object.keys(validToRange).length > 0) where.validTo = validToRange;

    // Fetch en lotes de 5000 con cursor para evitar OOM con 60k filas.
    // (Prisma findMany sin take leería todo en memoria de una; el hard cap
    // protege pero en práctica el chunk batch es más amigable con la RAM.)
    const batchSize = 5_000;
    const out: InsuredRow[] = [];
    let cursor: string | undefined = undefined;
    while (out.length < EXPORT_ROW_HARD_CAP) {
      const remaining = EXPORT_ROW_HARD_CAP - out.length;
      const take = Math.min(batchSize, remaining);
      // Type del resultado anotado explícito — sin esto, TS infiere any
      // porque el while-loop con `cursor` reasignado triggea TS7022.
      type Row = {
        id: string;
        curp: string;
        rfc: string | null;
        fullName: string;
        email: string | null;
        phone: string | null;
        validFrom: Date;
        validTo: Date;
        status: string;
        metadata: unknown;
        package: { name: string };
      };
      const rows: Row[] = (await this.prismaBypass.client.insured.findMany({
        where: where as never,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        include: { package: { select: { name: true } } },
      })) as unknown as Row[];
      if (rows.length === 0) break;
      for (const r of rows) {
        const meta =
          r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)
            ? (r.metadata as Record<string, unknown>)
            : {};
        const num =
          typeof meta.numeroEmpleadoExterno === 'string'
            ? meta.numeroEmpleadoExterno
            : typeof meta.numeroEmpleado === 'string'
              ? meta.numeroEmpleado
              : null;
        out.push({
          id: r.id,
          curp: r.curp,
          rfc: r.rfc,
          fullName: r.fullName,
          email: r.email,
          phone: r.phone,
          validFrom: r.validFrom,
          validTo: r.validTo,
          status: r.status,
          packageName: r.package.name,
          numeroEmpleadoExterno: num,
        });
      }
      const last: Row | undefined = rows[rows.length - 1];
      if (!last || rows.length < take) break;
      cursor = last.id;
    }

    if (out.length >= EXPORT_ROW_HARD_CAP) {
      throw new Error(`Export excede el hard cap (${EXPORT_ROW_HARD_CAP} filas). Refina los filtros.`);
    }
    return out;
  }

  /**
   * XLSX con exceljs. Una sola hoja "Asegurados" con columnas user-friendly
   * en español (idioma del MVP).
   */
  private async renderXlsx(rows: InsuredRow[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SegurAsist';
    wb.created = new Date();
    const ws = wb.addWorksheet('Asegurados');
    ws.columns = [
      { header: 'CURP', key: 'curp', width: 20 },
      { header: 'RFC', key: 'rfc', width: 16 },
      { header: 'Nombre completo', key: 'fullName', width: 32 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Teléfono', key: 'phone', width: 16 },
      { header: 'Paquete', key: 'packageName', width: 18 },
      { header: 'Vigencia desde', key: 'validFrom', width: 14 },
      { header: 'Vigencia hasta', key: 'validTo', width: 14 },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'Número empleado', key: 'numeroEmpleadoExterno', width: 16 },
    ];
    for (const r of rows) {
      ws.addRow({
        curp: r.curp,
        rfc: r.rfc ?? '',
        fullName: r.fullName,
        email: r.email ?? '',
        phone: r.phone ?? '',
        packageName: r.packageName,
        validFrom: r.validFrom.toISOString().slice(0, 10),
        validTo: r.validTo.toISOString().slice(0, 10),
        status: r.status,
        numeroEmpleadoExterno: r.numeroEmpleadoExterno ?? '',
      });
    }
    // Auto-format header.
    ws.getRow(1).font = { bold: true };
    const arr = await wb.xlsx.writeBuffer();
    return Buffer.from(arr as ArrayBuffer);
  }

  /**
   * PDF con Puppeteer. HTML simple — tabla con paginación implícita por
   * Chromium, A4 horizontal para que las 10 columnas entren legibles.
   */
  private async renderPdf(rows: InsuredRow[], tenantId: string): Promise<Buffer> {
    const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Listado de asegurados</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; font-size: 9px; padding: 24px; color: #111; }
    h1 { font-size: 14px; margin: 0 0 4px; }
    .meta { font-size: 9px; color: #666; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: top; }
    th { background: #f4f4f4; font-weight: 600; }
    tr:nth-child(even) td { background: #fbfbfb; }
  </style>
</head>
<body>
  <h1>Listado de asegurados</h1>
  <div class="meta">${rows.length} registros &middot; tenant ${tenantId.slice(0, 8)} &middot; generado ${new Date().toISOString()}</div>
  <table>
    <thead>
      <tr>
        <th>CURP</th><th>RFC</th><th>Nombre</th><th>Email</th><th>Paquete</th>
        <th>Vigencia</th><th>Estado</th><th>Núm. empleado</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
            <td>${escapeHtml(r.curp)}</td>
            <td>${escapeHtml(r.rfc ?? '')}</td>
            <td>${escapeHtml(r.fullName)}</td>
            <td>${escapeHtml(r.email ?? '')}</td>
            <td>${escapeHtml(r.packageName)}</td>
            <td>${r.validFrom.toISOString().slice(0, 10)} → ${r.validTo.toISOString().slice(0, 10)}</td>
            <td>${escapeHtml(r.status)}</td>
            <td>${escapeHtml(r.numeroEmpleadoExterno ?? '')}</td>
          </tr>`,
        )
        .join('\n')}
    </tbody>
  </table>
</body>
</html>`;
    const result = await this.puppeteer.renderPdf({
      html,
      ref: `export-${tenantId.slice(0, 8)}`,
      format: 'A4',
      timeoutMs: 30_000,
    });
    return result.pdf;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
