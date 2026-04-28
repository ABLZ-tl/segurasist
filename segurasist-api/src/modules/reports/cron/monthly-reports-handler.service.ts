/**
 * S4-04 — MonthlyReportsHandler.
 *
 * Consume la cola SQS `monthly-reports` (alimentada por la rule
 * EventBridge `cron-monthly-reports` el día 1 de cada mes 14:00 UTC).
 * Para cada mensaje:
 *   1. Resuelve el período reportado (mes anterior al `triggeredAt` por
 *      default, o `overridePeriod` si está presente).
 *   2. Itera todos los tenants ACTIVOS (`status='active'`, `deletedAt=null`).
 *   3. Para cada tenant:
 *      a. `INSERT` idempotente en `monthly_report_runs` con UNIQUE
 *         `(tenant_id, period_year, period_month)`. Si lanza P2002 ⇒
 *         skip (ya procesado en una entrega previa o re-trigger).
 *      b. Genera el PDF mensual via `ReportsService.generateMonthly...`
 *         (S1 owns la signature; mientras no exista, este handler usa
 *         un `MonthlyReportGenerator` injectable cuyo método default
 *         lanza NotImplemented — S1 lo reemplaza en iter 2 con la
 *         implementación real).
 *      c. Sube el PDF a S3 (`monthly-reports/{tenantId}/{year}-{mm}.pdf`).
 *      d. Envía email vía `SesService.send` con el PDF como link
 *         (presigned 7d) — NO attachment (SendEmailCommand SDK v3 NO
 *         soporta attachments; SendRawEmailCommand sí pero requiere MIME
 *         build manual; Sprint 5+ migra). El producto aceptó link en MVP.
 *      e. Marca `status='completed'` con `s3_key`, `email_message_id`,
 *         `recipient_count`, `completed_at`.
 *      f. Audit log `report.monthly.sent` con `period`, `tenant_id`.
 *      g. Si cualquier paso falla → `status='failed'` con
 *         `error_message` truncado y audit `report.monthly.failed`.
 *
 *   4. Borra el mensaje SQS sólo si la iteración GLOBAL terminó (success
 *      O failed-handled). Tenants con failures NO bloquean a otros: la
 *      semántica del cron es "best-effort por tenant".
 *
 * Idempotencia:
 *   - DB-side: UNIQUE en `monthly_report_runs`. Re-entrega SQS o
 *     re-trigger EventBridge ⇒ P2002 ⇒ skip ese tenant.
 *   - Email: si `runs[t].status='completed'`, NO se re-envía. Si está en
 *     `processing` (race condition entre 2 pollers), el segundo hace
 *     skip por el mismo P2002 al `INSERT` inicial.
 *
 * Tenant isolation:
 *   - El handler corre con BYPASSRLS (`PrismaBypassRlsService`). Cada
 *     query filtra explícitamente por `tenantId` igual que
 *     `ReportsWorker` — documentado en ADR-0001 (workers exentos del
 *     `assertPlatformAdmin` runtime check).
 *
 * NO bloquea el response HTTP — corre 100% async desde el polling loop.
 *
 * Tests: `test/integration/eventbridge-cron.spec.ts` cubre:
 *   - mock SQS message → handler procesa → `monthly_report_runs` row.
 *   - 2× mismo mensaje (idempotencia) → solo 1 email enviado.
 *   - tenant que falla en PDF generation → otros tenants NO se afectan.
 */
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { ENV_TOKEN } from '@config/config.module';
import type { Env } from '@config/env.schema';
import { S3Service } from '@infra/aws/s3.service';
import { SesService } from '@infra/aws/ses.service';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MonthlyReportCronEventSchema,
  resolveReportedPeriod,
  type MonthlyReportCronEvent,
} from './dto/monthly-report-event.dto';

const POLL_INTERVAL_MS = 5_000;
const MAX_ERROR_MESSAGE_LEN = 500;

/**
 * Generador del PDF mensual. S1 (Reports BE) implementa el método real
 * en `ReportsService.generateMonthly(...)` durante iter 2; mientras
 * tanto este handler depende de un provider inyectado que el módulo
 * registra como factory simple.
 *
 * Coordinación FEED: ver `docs/sprint4/feed/S3-iter1.md` —
 * NEEDS-COORDINATION con S1 sobre la signature exacta.
 */
export interface MonthlyReportGenerator {
  /**
   * Genera el PDF del reporte mensual para un tenant + período. Devuelve
   * el Buffer del PDF y un opcional `summary` (líneas/headers para el
   * cuerpo del email).
   */
  generate(input: {
    tenantId: string;
    period: { year: number; month: number };
  }): Promise<{ pdf: Buffer; summary?: { lineCount: number } }>;
}

/** Token DI para el generator — permite override en tests + S1 swap. */
export const MONTHLY_REPORT_GENERATOR = Symbol('MONTHLY_REPORT_GENERATOR');

@Injectable()
export class MonthlyReportsHandlerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(MonthlyReportsHandlerService.name);
  private readonly sqsClient: SQSClient;
  private polling = false;
  private stopRequested = false;
  private readonly enabled: boolean;

  constructor(
    private readonly prismaBypass: PrismaBypassRlsService,
    private readonly s3: S3Service,
    private readonly ses: SesService,
    private readonly auditWriter: AuditWriterService,
    @Inject(MONTHLY_REPORT_GENERATOR) private readonly generator: MonthlyReportGenerator,
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
        'MonthlyReportsHandler NO inicia poller (WORKERS_ENABLED!=true o NODE_ENV=test)',
      );
      return;
    }
    void this.runPollLoop();
    this.log.log(
      { queue: this.env.SQS_QUEUE_MONTHLY_REPORTS },
      'MonthlyReportsHandler poll loop started',
    );
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
          'MonthlyReportsHandler pollOnce failed',
        );
      } finally {
        this.polling = false;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  /**
   * Visible para tests. Lee N mensajes del SQS y los despacha
   * (delete-on-success por mensaje).
   */
  async pollOnce(): Promise<void> {
    const out = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.env.SQS_QUEUE_MONTHLY_REPORTS,
        MaxNumberOfMessages: 1, // cron events son raros; tomar 1 a la vez
        WaitTimeSeconds: 1,
        VisibilityTimeout: 600, // alineado con sqs queue VT (10 min)
      }),
    );
    const messages = out.Messages ?? [];
    for (const msg of messages) {
      try {
        const raw = JSON.parse(msg.Body ?? '{}') as Record<string, unknown>;
        const parsed = MonthlyReportCronEventSchema.safeParse(raw);
        if (!parsed.success) {
          this.log.warn(
            { errors: parsed.error.flatten(), msgId: msg.MessageId },
            'MonthlyReports: mensaje SQS con shape inválido; descartando',
          );
          if (msg.ReceiptHandle) {
            await this.sqsClient.send(
              new DeleteMessageCommand({
                QueueUrl: this.env.SQS_QUEUE_MONTHLY_REPORTS,
                ReceiptHandle: msg.ReceiptHandle,
              }),
            );
          }
          continue;
        }
        await this.handleEvent(parsed.data);
        if (msg.ReceiptHandle) {
          await this.sqsClient.send(
            new DeleteMessageCommand({
              QueueUrl: this.env.SQS_QUEUE_MONTHLY_REPORTS,
              ReceiptHandle: msg.ReceiptHandle,
            }),
          );
        }
      } catch (err) {
        // El handler captura per-tenant errors internamente; si llegamos
        // acá es algo no recuperable (e.g. SQS API down). El mensaje queda
        // en cola y la próxima iteración retry.
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err), msgId: msg.MessageId },
          'MonthlyReportsHandler handleEvent unexpected throw; mensaje permanece en cola',
        );
      }
    }
  }

  /**
   * Visible para tests. Procesa UN evento del cron iterando todos los
   * tenants activos. Devuelve el resumen para validación.
   */
  async handleEvent(event: MonthlyReportCronEvent): Promise<{
    period: { year: number; month: number };
    tenantsProcessed: number;
    tenantsCompleted: number;
    tenantsSkipped: number;
    tenantsFailed: number;
  }> {
    const triggeredAt = event.triggeredAt ? new Date(event.triggeredAt) : new Date();
    const period = resolveReportedPeriod(triggeredAt, event.overridePeriod);

    this.log.log(
      { period, triggeredBy: event.triggeredBy, triggeredAt: triggeredAt.toISOString() },
      'MonthlyReportsHandler procesando trigger',
    );

    const tenants = await this.prismaBypass.client.tenant.findMany({
      where: { status: 'active', deletedAt: null },
      select: { id: true, name: true },
    });

    let completed = 0;
    let skipped = 0;
    let failed = 0;
    for (const tenant of tenants) {
      const outcome = await this.processTenant({
        tenantId: tenant.id,
        tenantName: tenant.name,
        period,
        triggeredBy: event.triggeredBy,
      });
      if (outcome === 'completed') completed += 1;
      else if (outcome === 'skipped') skipped += 1;
      else failed += 1;
    }

    this.log.log(
      { period, total: tenants.length, completed, skipped, failed },
      'MonthlyReportsHandler trigger procesado',
    );

    return {
      period,
      tenantsProcessed: tenants.length,
      tenantsCompleted: completed,
      tenantsSkipped: skipped,
      tenantsFailed: failed,
    };
  }

  /**
   * Procesa UN tenant. Devuelve `'completed' | 'skipped' | 'failed'`.
   *
   * `skipped` ⇒ ya había una run en ese período (re-entrega). NO emite
   * email NI audit log (lo hizo la corrida original).
   * `failed` ⇒ una de las etapas (PDF gen / S3 / SES) lanzó. La fila
   * queda en `failed` con `error_message`.
   */
  private async processTenant(input: {
    tenantId: string;
    tenantName: string;
    period: { year: number; month: number };
    triggeredBy: 'eventbridge' | 'manual';
  }): Promise<'completed' | 'skipped' | 'failed'> {
    const { tenantId, tenantName, period, triggeredBy } = input;

    // 1) INSERT idempotente. UNIQUE (tenant_id, period_year, period_month)
    //    ⇒ P2002 si ya procesado.
    let runId: string;
    try {
      const created = await this.prismaBypass.client.monthlyReportRun.create({
        data: {
          tenantId,
          periodYear: period.year,
          periodMonth: period.month,
          status: 'pending',
          triggeredBy,
        },
        select: { id: true },
      });
      runId = created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.log.log(
          { tenantId, period },
          'MonthlyReports: run ya existe (P2002); skip — idempotencia DB-side',
        );
        return 'skipped';
      }
      throw err; // unexpected DB error: propaga para retry SQS
    }

    // 2) Generar PDF + subir S3 + enviar email. Cualquier fallo → failed.
    try {
      await this.prismaBypass.client.monthlyReportRun.update({
        where: { id: runId },
        data: { status: 'processing' },
      });

      const { pdf } = await this.generator.generate({ tenantId, period: { year: period.year, month: period.month } });
      const monthStr = String(period.month).padStart(2, '0');
      const s3Key = `monthly-reports/${tenantId}/${period.year}-${monthStr}.pdf`;

      await this.s3.putObject({
        Bucket: this.env.S3_BUCKET_EXPORTS,
        Key: s3Key,
        Body: pdf,
        ContentType: 'application/pdf',
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: this.env.KMS_KEY_ID,
        Metadata: {
          'x-tenant-id': tenantId,
          'x-period': `${period.year}-${monthStr}`,
          'x-kind': 'monthly-report',
        },
      });

      // Presigned URL TTL 7d (mismo TTL que email-worker para certs).
      const downloadUrl = await this.s3.getPresignedGetUrl(
        this.env.S3_BUCKET_EXPORTS,
        s3Key,
        7 * 24 * 60 * 60,
      );

      const recipients = this.env.MONTHLY_REPORT_RECIPIENTS;
      const subject = `Reporte mensual SegurAsist — ${tenantName} — ${period.year}/${monthStr}`;
      const html = renderEmailHtml({ tenantName, period, downloadUrl });
      const text = renderEmailText({ tenantName, period, downloadUrl });

      // SesService.sendEmail acepta `to: string[]` (legacy API) — usamos
      // ese path para multi-destinatario sin construir N llamadas.
      const messageId = await this.ses.sendEmail({
        to: recipients,
        subject,
        html,
        text,
        from: `monthly-reports@${this.env.SES_SENDER_DOMAIN}`,
      });

      await this.prismaBypass.client.monthlyReportRun.update({
        where: { id: runId },
        data: {
          status: 'completed',
          s3Key,
          recipientCount: recipients.length,
          emailMessageId: messageId ?? null,
          completedAt: new Date(),
        },
      });

      // Audit log fire-and-forget. Worker = sin req → ctx HTTP omitido
      // (auditWriter persiste el evento igual; ip/userAgent/traceId NULL).
      void this.auditWriter.record({
        tenantId,
        action: 'create',
        resourceType: 'report.monthly',
        resourceId: runId,
        payloadDiff: {
          subAction: 'sent',
          period,
          recipientCount: recipients.length,
          s3Key,
          triggeredBy,
        },
      });

      this.log.log({ tenantId, period, runId, recipients: recipients.length }, 'MonthlyReports: tenant completado');
      return 'completed';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prismaBypass.client.monthlyReportRun
        .update({
          where: { id: runId },
          data: {
            status: 'failed',
            errorMessage: message.slice(0, MAX_ERROR_MESSAGE_LEN),
            completedAt: new Date(),
          },
        })
        .catch(() => {
          // Si el UPDATE falla, sólo logueamos — la cola ya tiene el msg.
          this.log.error({ tenantId, runId }, 'MonthlyReports: UPDATE failed status falló');
        });
      void this.auditWriter.record({
        tenantId,
        action: 'create',
        resourceType: 'report.monthly',
        resourceId: runId,
        payloadDiff: { subAction: 'failed', period, error: message, triggeredBy },
      });
      this.log.error({ tenantId, period, err: message }, 'MonthlyReports: tenant falló');
      return 'failed';
    }
  }
}

/**
 * Default generator stub. Si S1 NO inyectó un generator real (e.g. en
 * tests sin DI), este lanza para forzar el fix. El módulo registra el
 * provider real en iter 2.
 */
export class NotImplementedMonthlyReportGenerator implements MonthlyReportGenerator {
  async generate(): Promise<{ pdf: Buffer }> {
    throw new Error(
      'MonthlyReportGenerator NO implementado. S1 (Reports BE) debe inyectar el provider real en iter 2.',
    );
  }
}

function renderEmailHtml(input: {
  tenantName: string;
  period: { year: number; month: number };
  downloadUrl: string;
}): string {
  const monthStr = String(input.period.month).padStart(2, '0');
  return `<!doctype html>
<html lang="es"><body style="font-family:system-ui,sans-serif;color:#111;padding:24px;max-width:640px;margin:auto">
  <h1 style="font-size:18px;margin:0 0 12px">Reporte mensual de cierre</h1>
  <p>Estimado equipo,</p>
  <p>Se generó el reporte mensual de conciliación de <strong>${escapeHtml(input.tenantName)}</strong>
  correspondiente al período <strong>${input.period.year}/${monthStr}</strong>.</p>
  <p style="margin:20px 0">
    <a href="${input.downloadUrl}" style="background:#0066cc;color:#fff;padding:10px 16px;text-decoration:none;border-radius:4px">Descargar PDF</a>
  </p>
  <p style="font-size:12px;color:#666">Este enlace caduca en 7 días. Si requiere un nuevo enlace, contáctenos.</p>
  <p style="font-size:11px;color:#999;margin-top:24px">SegurAsist · Reportes automáticos · NO responder a este correo.</p>
</body></html>`;
}

function renderEmailText(input: {
  tenantName: string;
  period: { year: number; month: number };
  downloadUrl: string;
}): string {
  const monthStr = String(input.period.month).padStart(2, '0');
  return [
    `Reporte mensual de cierre`,
    ``,
    `Tenant: ${input.tenantName}`,
    `Período: ${input.period.year}/${monthStr}`,
    ``,
    `Descargar PDF (7 días): ${input.downloadUrl}`,
    ``,
    `SegurAsist · Reportes automáticos`,
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
