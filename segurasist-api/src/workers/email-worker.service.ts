/**
 * Email Worker — envía email de certificado emitido (S2-04).
 *
 * Trigger: SQS `email-queue` recibe `certificate.issued` (del PdfWorker) o
 * `certificate.issued` synthetic (del endpoint resend-email).
 *
 * Pipeline por evento:
 *   carga cert + insured + tenant → resuelve template (cache) → genera URL
 *   presigned (TTL 7d) → render html+txt → send vía SesService → persist
 *   email_events (queued+sent).
 *
 * Si insured.email es null: skip + log warning + persiste fila
 * `delivery_status=skipped_no_email` en email_events (event_type=`rejected`
 * ya que el enum no tiene `skipped`; usamos detail JSON para discriminar).
 */
import { randomUUID } from 'node:crypto';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { S3Service } from '@infra/aws/s3.service';
import { SesService } from '@infra/aws/ses.service';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { type CertificateIssuedEvent } from '../events/certificate-events';
import type { TenantBrand } from '../modules/certificates/template-resolver';
import { EmailTemplateResolver } from '../modules/email/email-template-resolver';

const POLL_INTERVAL_MS = 3_000;

interface SyntheticIssuedEvent extends CertificateIssuedEvent {
  /** Resend con destinatario override (no presente en el evento upstream real). */
  overrideTo?: string;
}

@Injectable()
export class EmailWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(EmailWorkerService.name);
  private readonly resolver = new EmailTemplateResolver();
  private readonly sqsClient: SQSClient;
  private polling = false;
  private stopRequested = false;

  constructor(
    private readonly prismaBypass: PrismaBypassRlsService,
    private readonly s3: S3Service,
    private readonly ses: SesService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.sqsClient = new SQSClient({
      region: env.AWS_REGION,
      ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
    });
  }

  onApplicationBootstrap(): void {
    if (this.env.NODE_ENV === 'test') return;
    void this.runPollLoop();
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
          'EmailWorker pollOnce failed',
        );
      } finally {
        this.polling = false;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  async pollOnce(): Promise<void> {
    const out = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.env.SQS_QUEUE_EMAIL,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 1,
        VisibilityTimeout: 60,
      }),
    );
    const messages = out.Messages ?? [];
    for (const msg of messages) {
      try {
        const body = JSON.parse(msg.Body ?? '{}') as SyntheticIssuedEvent;
        if (body.kind !== 'certificate.issued') {
          // Ignoramos eventos que no son de email (e.g. failure events).
          if (msg.ReceiptHandle) {
            await this.sqsClient.send(
              new DeleteMessageCommand({
                QueueUrl: this.env.SQS_QUEUE_EMAIL,
                ReceiptHandle: msg.ReceiptHandle,
              }),
            );
          }
          continue;
        }
        await this.handleIssued(body);
        if (msg.ReceiptHandle) {
          await this.sqsClient.send(
            new DeleteMessageCommand({
              QueueUrl: this.env.SQS_QUEUE_EMAIL,
              ReceiptHandle: msg.ReceiptHandle,
            }),
          );
        }
      } catch (err) {
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'EmailWorker handleIssued failed; mensaje queda en cola',
        );
      }
    }
  }

  /**
   * Visible para tests. Consume un evento `certificate.issued` y envía el email.
   */
  async handleIssued(event: SyntheticIssuedEvent): Promise<{
    sent: boolean;
    skipped?: 'no_email';
    messageId?: string;
  }> {
    const cert = await this.prismaBypass.client.certificate.findFirst({
      where: { id: event.certificateId, tenantId: event.tenantId, deletedAt: null },
    });
    if (!cert) {
      this.log.warn({ certId: event.certificateId }, 'EmailWorker: cert not found');
      return { sent: false };
    }
    const insured = await this.prismaBypass.client.insured.findFirst({
      where: { id: cert.insuredId, tenantId: event.tenantId, deletedAt: null },
      include: { package: true },
    });
    if (!insured) return { sent: false };
    const tenant = await this.prismaBypass.client.tenant.findFirst({
      where: { id: event.tenantId },
      select: { id: true, name: true, brandJson: true },
    });
    if (!tenant) return { sent: false };

    const brand = (tenant.brandJson as (TenantBrand & { emailTemplate?: string }) | null) ?? null;
    const recipient = event.overrideTo ?? insured.email ?? '';

    if (!recipient) {
      // Sin email: persistimos rechazo + log warning. NO falla.
      await this.prismaBypass.client.emailEvent.create({
        data: {
          tenantId: tenant.id,
          certificateId: cert.id,
          eventType: 'rejected',
          recipient: '(none)',
          detail: { reason: 'skipped_no_email' },
          messageId: null,
        },
      });
      this.log.warn({ insuredId: insured.id }, 'EmailWorker: insured sin email; skip');
      return { sent: false, skipped: 'no_email' };
    }

    // Persist `queued` antes del send.
    const queued = await this.prismaBypass.client.emailEvent.create({
      data: {
        tenantId: tenant.id,
        certificateId: cert.id,
        eventType: 'queued',
        recipient,
        detail: { template: 'certificate-issued', overrideTo: event.overrideTo ?? null },
      },
    });

    const downloadTtl = 7 * 24 * 60 * 60;
    const downloadUrl = await this.s3.getPresignedGetUrl(
      this.env.S3_BUCKET_CERTIFICATES,
      cert.s3Key,
      downloadTtl,
    );

    const { html, text } = await this.resolver.loadForTenant({ brand });
    const ctx = {
      insured: { fullName: insured.fullName },
      package: { name: insured.package.name },
      validTo: insured.validTo.toISOString().slice(0, 10),
      downloadUrl,
      tenant: {
        name: tenant.name,
        logo: brand?.logo ?? '',
        supportEmail: brand?.supportEmail ?? '',
      },
    };
    const htmlBody = html(ctx);
    const textBody = text(ctx);

    const from = brand?.emailFrom ?? this.env.EMAIL_FROM_CERT;
    const traceId = randomUUID();

    try {
      const result = await this.ses.send({
        to: recipient,
        from,
        subject: `Tu certificado ${insured.package.name} está listo`,
        html: htmlBody,
        text: textBody,
        configurationSet: `segurasist-${this.env.NODE_ENV}`,
        headers: { 'X-Trace-Id': traceId },
        tags: { cert: cert.id },
      });
      await this.prismaBypass.client.emailEvent.create({
        data: {
          tenantId: tenant.id,
          certificateId: cert.id,
          eventType: 'sent',
          recipient,
          messageId: result.messageId,
          detail: { transport: result.transport, traceId, queuedEventId: queued.id },
        },
      });
      return { sent: true, messageId: result.messageId };
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'EmailWorker: SES send failed',
      );
      await this.prismaBypass.client.emailEvent.create({
        data: {
          tenantId: tenant.id,
          certificateId: cert.id,
          eventType: 'rejected',
          recipient,
          detail: {
            reason: 'send_failed',
            error: err instanceof Error ? err.message : String(err),
          },
        },
      });
      return { sent: false };
    }
  }
}
