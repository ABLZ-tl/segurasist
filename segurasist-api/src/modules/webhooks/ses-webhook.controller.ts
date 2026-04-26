/**
 * SES webhook (prod). En MVP local NO se usa — Mailpit no firma SNS, los
 * eventos se sintetizan vía MailpitTrackerService. Este controller queda
 * implementado para que cuando Sprint 5 cablee SES + SNS reales (Notification
 * + SubscriptionConfirmation), simplemente apunte el SNS topic acá.
 *
 * Verificación firma: usamos `aws-sns-validator` cuando esté disponible
 * (dep opcional); fallback a verificación manual contra el cert SNS bajado
 * de la URL `SigningCertURL` (debe ser amazonaws.com).
 *
 * Reglas:
 *   - Bounce hard → marca `insureds.email = NULL` (degrada a no-email) +
 *     persiste evento.
 *   - Soft bounce → SES retry 3 veces internamente; nosotros sólo persistimos.
 *   - Open / Click → persistimos evento.
 */
import { Public } from '@common/decorators/roles.decorator';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { Body, Controller, HttpCode, HttpStatus, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { type EmailEventType } from '@prisma/client';

interface SnsEnvelope {
  Type?: string;
  MessageId?: string;
  Token?: string;
  TopicArn?: string;
  Message?: string;
  Timestamp?: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
  SubscribeURL?: string;
  UnsubscribeURL?: string;
}

interface SesEvent {
  eventType?: 'Send' | 'Delivery' | 'Bounce' | 'Complaint' | 'Open' | 'Click' | 'Reject';
  mail?: {
    messageId?: string;
    destination?: string[];
    tags?: Record<string, string[]>;
    headers?: Array<{ name: string; value: string }>;
  };
  bounce?: { bounceType?: 'Permanent' | 'Transient'; bouncedRecipients?: Array<{ emailAddress: string }> };
  delivery?: unknown;
  open?: unknown;
  click?: unknown;
  complaint?: unknown;
}

const SES_TO_PRISMA: Record<string, EmailEventType> = {
  Send: 'sent',
  Delivery: 'delivered',
  Bounce: 'bounced',
  Complaint: 'complained',
  Open: 'opened',
  Click: 'clicked',
  Reject: 'rejected',
};

@Controller({ path: 'webhooks', version: '1' })
export class SesWebhookController {
  private readonly log = new Logger(SesWebhookController.name);

  constructor(private readonly prismaBypass: PrismaBypassRlsService) {}

  @Public()
  @Post('ses')
  @HttpCode(HttpStatus.NO_CONTENT)
  async ses(@Body() body: SnsEnvelope): Promise<void> {
    if (!body || typeof body !== 'object') {
      throw new UnauthorizedException('SES_WEBHOOK_INVALID_PAYLOAD');
    }
    // Verificación firma SNS — best effort. En prod requerimos
    // SigningCertURL hospedada en amazonaws.com; sin esa garantía, rechazamos.
    if (process.env.NODE_ENV === 'production') {
      const certUrl = body.SigningCertURL ?? '';
      if (!/^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(certUrl)) {
        throw new UnauthorizedException('SES_WEBHOOK_BAD_CERT_URL');
      }
      // TODO Sprint 5: integrar `aws-sns-validator` cuando se agregue la dep.
      // De momento NO validamos la firma criptográficamente — confiamos en
      // que el WAF + el endpoint privado limitan vectores. Documentado en
      // INTERIM_RISKS.md (agente D).
    }

    if (body.Type === 'SubscriptionConfirmation') {
      // Auto-confirm: visitar SubscribeURL. Best-effort.
      if (body.SubscribeURL) {
        try {
          await fetch(body.SubscribeURL);
          this.log.log({ topic: body.TopicArn }, 'SNS subscription confirmed');
        } catch (err) {
          this.log.warn({ err: String(err) }, 'SNS subscription confirm failed');
        }
      }
      return;
    }

    if (body.Type !== 'Notification' || !body.Message) return;

    let evt: SesEvent;
    try {
      evt = JSON.parse(body.Message) as SesEvent;
    } catch {
      this.log.warn({ raw: body.Message }, 'SES webhook: Message no parseable');
      return;
    }

    const sesType = evt.eventType ?? '';
    const mapped = SES_TO_PRISMA[sesType];
    if (!mapped) return;

    const messageId = evt.mail?.messageId ?? null;
    const recipient = evt.mail?.destination?.[0] ?? '(unknown)';
    const tagCert = (evt.mail?.tags?.['cert'] ?? [])[0] ?? null;

    if (!tagCert) {
      this.log.warn({ messageId, sesType }, 'SES webhook: sin tag cert; ignorado');
      return;
    }

    const cert = await this.prismaBypass.client.certificate.findFirst({
      where: { id: tagCert },
      select: { id: true, tenantId: true, insuredId: true },
    });
    if (!cert) return;

    await this.prismaBypass.client.emailEvent.create({
      data: {
        tenantId: cert.tenantId,
        certificateId: cert.id,
        eventType: mapped,
        recipient,
        messageId,
        detail: { sesEventType: sesType, source: 'ses-webhook' },
      },
    });

    // Hard bounce: marcar insured.email = NULL (no más sends automáticos).
    if (sesType === 'Bounce' && evt.bounce?.bounceType === 'Permanent') {
      await this.prismaBypass.client.insured.update({
        where: { id: cert.insuredId },
        data: { email: null },
      });
      this.log.warn({ insuredId: cert.insuredId }, 'hard bounce → email cleared');
    }
  }
}
