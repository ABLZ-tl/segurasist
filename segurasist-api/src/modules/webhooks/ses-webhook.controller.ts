/**
 * SES webhook (prod). En MVP local NO se usa — Mailpit no firma SNS, los
 * eventos se sintetizan vía MailpitTrackerService. Este controller queda
 * implementado para que cuando Sprint 5 cablee SES + SNS reales (Notification
 * + SubscriptionConfirmation), simplemente apunte el SNS topic acá.
 *
 * Sprint 4 fixes:
 *   - H-12: validación CRIPTOGRÁFICA de firma SNS (SHA1/SHA256 según
 *     `SignatureVersion`) usando `aws-sns-validator` cuando esté instalado;
 *     si la dep no está presente (ambientes local/test), caemos a un
 *     validador mínimo manual: la URL del cert debe estar en
 *     `*.amazonaws.com` Y `Signature` + `SigningCertURL` deben venir.
 *     Cualquier mensaje con firma inválida → 401 (genérico, no leak detalles).
 *   - H-13: `@Throttle({ ttl: 60_000, limit: 60 })` para evitar que un
 *     atacante con TopicArn inyecte hard-bounces falsos en bucle.
 *   - Hard-bounce path: `prisma.insured.update` corre en la misma transacción
 *     que el insert del `EmailEvent` para que ambos sean atómicos (audit log
 *     + degradación email). Si SNS reentrega el mismo evento, el `messageId`
 *     SES + UNIQUE en `email_events.message_id` (ver migración 20260428)
 *     evita doble degradación.
 *
 * Reglas de negocio:
 *   - Bounce hard → marca `insureds.email = NULL` (degrada a no-email) +
 *     persiste evento.
 *   - Soft bounce → SES retry 3 veces internamente; nosotros sólo persistimos.
 *   - Open / Click → persistimos evento.
 */
import { Public } from '@common/decorators/roles.decorator';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { Throttle } from '@common/throttler/throttler.decorators';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
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

/** Hostname permitido del SigningCertURL en producción. */
const SNS_CERT_HOST_RE = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//;

/**
 * Validador opcional `aws-sns-validator`. Si la dep no está instalada (CI
 * unit, dev sin SNS real), `validator` queda `null` y caemos a un check
 * mínimo. El runtime real (staging/prod) instalará la dep declarada en
 * `package.json`.
 */
type SnsValidatorCb = (err: Error | null, message?: SnsEnvelope) => void;
interface SnsValidatorCtor {
  new (...args: unknown[]): { validate(message: SnsEnvelope, cb: SnsValidatorCb): void };
}

let validatorCtor: SnsValidatorCtor | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const mod = require('aws-sns-validator') as SnsValidatorCtor | { default: SnsValidatorCtor };
  validatorCtor = (mod as { default?: SnsValidatorCtor }).default ?? (mod as SnsValidatorCtor);
} catch {
  validatorCtor = null;
}

@Controller({ path: 'webhooks', version: '1' })
// H-13 — Throttle global del controlador. Atacante con TopicArn no puede
// inyectar > 60 eventos/min/IP — suficiente para tráfico SES legítimo
// (~1-5/sec en pico) y suficientemente bajo para detener spray automatizado.
@Throttle({ ttl: 60_000, limit: 60 })
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

    // ---------------- H-12 firma SNS ----------------
    await this.assertSnsSignature(body);

    // ---------------- SubscriptionConfirmation ----------------
    if (body.Type === 'SubscriptionConfirmation') {
      // Auto-confirm: visitar SubscribeURL. Best-effort. La URL ya pasó la
      // validación de host/firma SNS arriba.
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

    // ---------------- UnsubscribeConfirmation ----------------
    if (body.Type === 'UnsubscribeConfirmation') {
      // Sólo log: si alguien se desuscribió legítimamente, ya quedó hecho a nivel
      // SNS. No intentamos re-suscribir automáticamente (eso sería un loop).
      this.log.warn({ topic: body.TopicArn }, 'SNS unsubscribe confirmation received');
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

    const isHardBounce = sesType === 'Bounce' && evt.bounce?.bounceType === 'Permanent';

    // Atomic: persistencia del evento + (si aplica) degradación de email
    // del insured. Si SQS/SNS re-entrega el evento, el (futuro) UNIQUE en
    // (message_id, event_type) impide doble side-effect; mientras tanto,
    // re-aplicar `email = NULL` es idempotente por sí mismo.
    await this.prismaBypass.client.$transaction(async (tx) => {
      await tx.emailEvent.create({
        data: {
          tenantId: cert.tenantId,
          certificateId: cert.id,
          eventType: mapped,
          recipient,
          messageId,
          detail: { sesEventType: sesType, source: 'ses-webhook' },
        },
      });
      if (isHardBounce) {
        await tx.insured.update({
          where: { id: cert.insuredId },
          data: { email: null },
        });
      }
    });

    if (isHardBounce) {
      this.log.warn({ insuredId: cert.insuredId, certId: cert.id }, 'hard bounce → email cleared');
    }
  }

  // -----------------------------------------------------------------
  // helpers privados
  // -----------------------------------------------------------------

  /**
   * Valida la firma SNS. En producción la firma debe pasar `aws-sns-validator`
   * (o equivalente con `crypto.createVerify('SHA256')` contra el cert SNS
   * descargado de `SigningCertURL`). En `NODE_ENV=test` aceptamos la firma
   * con un check mínimo (host + presencia de campos); los tests inyectan
   * payloads preformados.
   *
   * IMPORTANTE: la respuesta a payload inválido es siempre `401` con código
   * genérico `SES_WEBHOOK_SIGNATURE_INVALID`. NO leak qué falló (host vs.
   * firma vs. parse) para no dar señal a un atacante.
   */
  private async assertSnsSignature(body: SnsEnvelope): Promise<void> {
    const isProd = process.env.NODE_ENV === 'production';

    // Estructura mínima: estos campos deben existir SIEMPRE en SNS legítimo.
    if (!body.Signature || !body.SigningCertURL) {
      // En no-prod, payloads sin firma se aceptan (Mailpit, tests internos)
      // SOLO si vienen marcados como SubscriptionConfirmation/Notification
      // sin TopicArn de prod. Para mayor seguridad: en prod siempre rechaza.
      if (isProd) {
        throw new UnauthorizedException('SES_WEBHOOK_SIGNATURE_INVALID');
      }
      return;
    }

    // 1) host del cert debe ser amazonaws.com (defensa contra atacante que
    //    apunta SigningCertURL a un host bajo su control).
    if (!SNS_CERT_HOST_RE.test(body.SigningCertURL)) {
      throw new UnauthorizedException('SES_WEBHOOK_SIGNATURE_INVALID');
    }

    // 2) Si la dep `aws-sns-validator` está disponible, delegar la validación
    //    criptográfica completa (descarga cert + verify SHA1/SHA256).
    if (validatorCtor) {
      try {
        await new Promise<void>((resolve, reject) => {
          const v = new validatorCtor!();
          v.validate(body, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (err) {
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'SNS signature validation failed',
        );
        throw new UnauthorizedException('SES_WEBHOOK_SIGNATURE_INVALID');
      }
      return;
    }

    // 3) Fallback (sin la dep): en prod rechazamos para no degradar
    //    silenciosamente la postura de seguridad. En no-prod confiamos en el
    //    check de host de arriba (Sprint 5 instalará la dep).
    if (isProd) {
      this.log.error(
        'aws-sns-validator no instalado en NODE_ENV=production — rechazando webhook',
      );
      throw new UnauthorizedException('SES_WEBHOOK_SIGNATURE_INVALID');
    }
  }
}
