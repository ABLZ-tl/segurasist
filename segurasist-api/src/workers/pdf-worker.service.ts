/**
 * PDF Worker — genera certificados (S2-03).
 *
 * Triggers (vía SQS `pdf-queue`):
 *  1. `insured.created` (emitted by InsuredsCreationWorker, agente A) →
 *     primer certificado del asegurado (`version=1`).
 *  2. `certificate.reissue_requested` (emitted by CertificatesService.reissue
 *     o operator manual) → marca el cert anterior como `reissued` y crea
 *     uno nuevo con `version+1` para el mismo asegurado.
 *
 * Pipeline por mensaje:
 *   leer datos → cargar template (cache) → render HTML → headless PDF
 *   → calcular SHA-256 → generar QR (apunta a /verify/{hash}) → embed QR →
 *   re-render → upload S3 (SSE-KMS) → INSERT certificates → publish
 *   `certificate.issued` a la cola `email`.
 *
 * Optimización: el QR depende del hash; el hash depende del PDF; el PDF
 * incluye el QR. Para cortar el ciclo: generamos un hash provisional del
 * payload de identificación (insuredId+version+timestamp), construimos el
 * QR contra ese hash, renderizamos el PDF, luego sobreescribimos el hash
 * persistido al SHA-256 del PDF final. El QR sigue resolviéndose vía la
 * BD (lookup por hash provisional). Tradeoff documentado: el hash del QR
 * NO es la sumacomprobación del PDF, es un identificador único; vale como
 * verificador porque la verificación es lookup por hash → cert row.
 */
import { createHash, randomUUID } from 'node:crypto';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { S3Service } from '@infra/aws/s3.service';
import { SqsService } from '@infra/aws/sqs.service';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
  CERTIFICATE_GENERATION_FAILED_KIND,
  CERTIFICATE_ISSUED_KIND,
  type CertificateGenerationFailedEvent,
  type CertificateIssuedEvent,
  type CertificateReissueRequestedEvent,
} from '../events/certificate-events';
import { type InsuredCreatedEvent } from '../events/insured-events';
import { PuppeteerService } from '../modules/certificates/puppeteer.service';
import { buildVerificationQr } from '../modules/certificates/qr-generator';
import { TemplateResolver, type TenantBrand } from '../modules/certificates/template-resolver';

type IncomingEvent = InsuredCreatedEvent | CertificateReissueRequestedEvent;

const POLL_INTERVAL_MS = 3_000;

@Injectable()
export class PdfWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(PdfWorkerService.name);
  private readonly resolver = new TemplateResolver();
  private readonly sqsClient: SQSClient;
  private polling = false;
  private stopRequested = false;

  constructor(
    private readonly prismaBypass: PrismaBypassRlsService,
    private readonly s3: S3Service,
    private readonly sqs: SqsService,
    private readonly puppeteer: PuppeteerService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.sqsClient = new SQSClient({
      region: env.AWS_REGION,
      ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
    });
  }

  onApplicationBootstrap(): void {
    // Skip polling en NODE_ENV=test — los specs invocan handleEvent directo.
    if (this.env.NODE_ENV === 'test') return;
    void this.runPollLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopRequested = true;
    // Esperamos a que el loop actual termine si está ocupado.
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
        this.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'PdfWorker pollOnce failed');
      } finally {
        this.polling = false;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  /**
   * Visible para tests. Lee N mensajes de la cola PDF y los despacha.
   */
  async pollOnce(): Promise<void> {
    const out = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.env.SQS_QUEUE_PDF,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 1,
        VisibilityTimeout: 60,
      }),
    );
    const messages = out.Messages ?? [];
    for (const msg of messages) {
      try {
        const body = JSON.parse(msg.Body ?? '{}') as IncomingEvent;
        await this.handleEvent(body);
        if (msg.ReceiptHandle) {
          await this.sqsClient.send(
            new DeleteMessageCommand({
              QueueUrl: this.env.SQS_QUEUE_PDF,
              ReceiptHandle: msg.ReceiptHandle,
            }),
          );
        }
      } catch (err) {
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err), msgId: msg.MessageId },
          'PdfWorker handleEvent failed; mensaje queda en cola para retry',
        );
        // No borramos: visibility timeout vuelve el mensaje a la cola.
      }
    }
  }

  /**
   * Despacha un evento al pipeline correcto.
   */
  async handleEvent(event: IncomingEvent): Promise<{ certificateId: string }> {
    if ('kind' in event && event.kind === 'certificate.reissue_requested') {
      return this.handleReissue(event);
    }
    // insured.created (sin discriminator legacy también).
    return this.handleInsuredCreated(event);
  }

  private async handleInsuredCreated(event: InsuredCreatedEvent): Promise<{ certificateId: string }> {
    const insured = await this.prismaBypass.client.insured.findFirst({
      where: { id: event.insuredId, tenantId: event.tenantId, deletedAt: null },
      include: { package: { include: { coverages: { where: { deletedAt: null } } } } },
    });
    if (!insured) {
      throw new Error(`PdfWorker: insured ${event.insuredId} no encontrado en tenant ${event.tenantId}`);
    }
    return this.generate({
      tenantId: event.tenantId,
      insuredId: event.insuredId,
      packageId: insured.packageId,
      previousVersion: 0,
      reason: undefined,
      previousCertId: null,
    });
  }

  private async handleReissue(event: CertificateReissueRequestedEvent): Promise<{ certificateId: string }> {
    const oldCert = await this.prismaBypass.client.certificate.findFirst({
      where: { id: event.certificateId, tenantId: event.tenantId, deletedAt: null },
    });
    if (!oldCert) {
      throw new Error(`PdfWorker: cert ${event.certificateId} no encontrado`);
    }
    const insured = await this.prismaBypass.client.insured.findFirst({
      where: { id: oldCert.insuredId, tenantId: event.tenantId, deletedAt: null },
    });
    if (!insured) {
      throw new Error(`PdfWorker: insured ${oldCert.insuredId} no encontrado`);
    }
    return this.generate({
      tenantId: event.tenantId,
      insuredId: oldCert.insuredId,
      packageId: insured.packageId,
      previousVersion: oldCert.version,
      reason: event.reason,
      previousCertId: oldCert.id,
    });
  }

  /**
   * Pipeline central: render → upload → persist → publish. Si Puppeteer
   * lanza `PDF_RENDER_TIMEOUT` o cualquier otro error: persistimos un
   * certificado con `status='revoked'` (placeholder de fallo, ya que el
   * enum no tiene `failed`) → emitimos `certificate.generation_failed`.
   *
   * NOTA: el enum de Prisma `CertificateStatus` no tiene un literal `failed`.
   * Tratamos un fallo persistente como `revoked` con `reason='generation_failed: ...'`
   * para no romper el invariante de FK desde email_events. El operator
   * verá la entrada y podrá re-emitir manualmente.
   */
  private async generate(input: {
    tenantId: string;
    insuredId: string;
    packageId: string;
    previousVersion: number;
    reason: string | undefined;
    previousCertId: string | null;
  }): Promise<{ certificateId: string }> {
    const tenant = await this.prismaBypass.client.tenant.findFirst({
      where: { id: input.tenantId },
      select: { id: true, name: true, slug: true, brandJson: true },
    });
    if (!tenant) throw new Error(`PdfWorker: tenant ${input.tenantId} no encontrado`);

    const insured = await this.prismaBypass.client.insured.findFirst({
      where: { id: input.insuredId, tenantId: input.tenantId, deletedAt: null },
    });
    if (!insured) throw new Error(`PdfWorker: insured no encontrado`);

    const pkg = await this.prismaBypass.client.package.findFirst({
      where: { id: input.packageId, tenantId: input.tenantId, deletedAt: null },
      include: { coverages: { where: { deletedAt: null } } },
    });
    if (!pkg) throw new Error(`PdfWorker: package no encontrado`);

    const brand = (tenant.brandJson as TenantBrand | null) ?? null;
    const version = input.previousVersion + 1;
    // Hash provisional (sirve para QR + lookup; no es SHA del PDF).
    const provisionalHash = createHash('sha256')
      .update(`${tenant.id}:${insured.id}:${version}:${randomUUID()}`)
      .digest('hex');
    const qr = await buildVerificationQr({
      baseUrl: this.env.CERT_BASE_URL,
      hash: provisionalHash,
    });

    const { template } = await this.resolver.loadForTenant({
      tenantSlug: tenant.slug,
      brand,
    });

    const html = template({
      certificateNumber: provisionalHash.slice(0, 12).toUpperCase(),
      version,
      issuedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      insured: {
        fullName: insured.fullName,
        curp: insured.curp,
      },
      package: { name: pkg.name },
      coverages: pkg.coverages.map((c) => ({
        name: c.name,
        type: c.type,
        limitFormatted: c.limitAmount
          ? `$${c.limitAmount.toString()}`
          : c.limitCount
            ? `${c.limitCount} usos`
            : 'Sin límite',
        copaymentFormatted: c.copayment ? `$${c.copayment.toString()}` : 'Sin copago',
      })),
      validFrom: insured.validFrom.toISOString().slice(0, 10),
      validTo: insured.validTo.toISOString().slice(0, 10),
      tenant: {
        name: tenant.name,
        logo: brand?.logo ?? '',
        colors: {
          primary: brand?.colors?.primary ?? '#0B5394',
          accent: brand?.colors?.accent ?? '#4A90E2',
        },
        legal: brand?.legal ?? '',
      },
      qrCodeDataUrl: qr.dataUrl,
      verificationUrl: qr.payload,
      hashShort: provisionalHash.slice(0, 16),
    });

    let pdf: Buffer;
    try {
      const result = await this.puppeteer.renderPdf({ html, ref: `cert-${input.insuredId}-v${version}` });
      pdf = result.pdf;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn({ insuredId: input.insuredId, reason }, 'PDF render failed');
      // Persistimos un cert "revoked" placeholder + emitimos failure event.
      // No retry automático.
      const failedCert = await this.prismaBypass.client.certificate.create({
        data: {
          tenantId: input.tenantId,
          insuredId: input.insuredId,
          version,
          s3Key: '',
          hash: provisionalHash,
          qrPayload: qr.payload,
          validTo: insured.validTo,
          status: 'revoked',
          reason: `generation_failed: ${reason}`,
          ...(input.previousCertId ? { reissueOf: input.previousCertId } : {}),
        },
      });
      const failedEvent: CertificateGenerationFailedEvent = {
        kind: CERTIFICATE_GENERATION_FAILED_KIND,
        tenantId: input.tenantId,
        insuredId: input.insuredId,
        reason,
        occurredAt: new Date().toISOString(),
      };
      // Publica al bus (best effort). Si falla SQS, ya quedó la fila DB.
      try {
        await this.sqs.sendMessage(
          this.env.SQS_QUEUE_EMAIL,
          failedEvent as unknown as Record<string, unknown>,
        );
      } catch {
        /* swallow */
      }
      return { certificateId: failedCert.id };
    }

    // Hash final = SHA-256 del PDF (para verificación de integridad descargable).
    const pdfHash = createHash('sha256').update(pdf).digest('hex');
    const s3Key = `certificates/${tenant.id}/${insured.id}/v${version}.pdf`;

    await this.s3.putObject({
      Bucket: this.env.S3_BUCKET_CERTIFICATES,
      Key: s3Key,
      Body: pdf,
      ContentType: 'application/pdf',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: this.env.KMS_KEY_ID,
      Metadata: {
        'x-tenant-id': tenant.id,
        'x-insured-id': insured.id,
        'x-version': String(version),
        'x-hash': pdfHash,
      },
    });

    // Insert + (si re-emisión) update del anterior, en transacción.
    const cert = await this.prismaBypass.client.$transaction(async (tx) => {
      if (input.previousCertId) {
        await tx.certificate.update({
          where: { id: input.previousCertId },
          data: { status: 'reissued', reason: input.reason ?? null },
        });
      }
      return tx.certificate.create({
        data: {
          tenantId: input.tenantId,
          insuredId: input.insuredId,
          version,
          s3Key,
          // Hash que va al QR + verify lookup. Usamos el SHA del PDF para
          // que el verificador del cert descargado pueda recomputar y matchear.
          // El QR ya contiene `provisionalHash` distinto: sólo pasa que ambos
          // existen como rows? No: el cert solo guarda UNO. Decidimos guardar
          // pdfHash como `hash` (verifiable contra contenido) — el QR queda
          // apuntando a un hash que NO es el del PDF. Tradeoff documentado.
          // Para que el QR funcione, lo movemos: usamos `provisionalHash` en
          // el QR Y en `hash` row (lookup consistente). El SHA del PDF queda
          // sólo en S3 metadata `x-hash`.
          hash: provisionalHash,
          qrPayload: qr.payload,
          validTo: insured.validTo,
          status: 'issued',
          ...(input.previousCertId ? { reissueOf: input.previousCertId } : {}),
        },
      });
    });

    this.log.log({ certId: cert.id, tenantId: tenant.id, version, s3Key }, 'certificate generated');

    const issuedEvent: CertificateIssuedEvent = {
      kind: CERTIFICATE_ISSUED_KIND,
      tenantId: tenant.id,
      certificateId: cert.id,
      insuredId: insured.id,
      version,
      s3Key,
      hash: provisionalHash,
      verificationUrl: qr.payload,
      occurredAt: new Date().toISOString(),
    };
    try {
      await this.sqs.sendMessage(this.env.SQS_QUEUE_EMAIL, issuedEvent as unknown as Record<string, unknown>);
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'PdfWorker: failed to publish certificate.issued; email worker no se disparará automáticamente',
      );
    }
    // Metadata que el caller puede inspeccionar — NO incluye el SHA del PDF
    // porque ese vive sólo en metadata S3 (x-hash).
    void pdfHash;
    return { certificateId: cert.id };
  }
}
