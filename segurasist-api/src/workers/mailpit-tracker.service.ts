/**
 * MailpitTrackerService — solo dev. Polling de Mailpit para sintetizar
 * eventos `delivered` / `opened` análogos a los que SES emitiría en prod
 * vía SNS.
 *
 * Estrategia:
 *   - Cada 10s, GET `http://localhost:8025/api/v1/messages?query=tag:cert&limit=50`.
 *   - Para cada mensaje nuevo (cache de IDs vistos en Redis con TTL 1d):
 *     persistimos `email_events.event_type='delivered'` con timestamp Mailpit.
 *   - Si Mailpit reporta `Read=true`: persistimos `event_type='opened'`.
 *
 * Match certificate ↔ message: el SesService inyecta `X-Tag-cert: <certId>`
 * en headers; el query de Mailpit `tag:cert` los filtra. Para extraer el
 * certId del mensaje individual hacemos parse del header.
 *
 * Skip si NODE_ENV !== 'development'.
 */
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { RedisService } from '@infra/cache/redis.service';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

const POLL_INTERVAL_MS = 10_000;
const SEEN_TTL_SECONDS = 24 * 60 * 60;
const REDIS_PREFIX = 'mailpit:seen:';

interface MailpitMessage {
  ID: string;
  MessageID: string;
  From?: { Address: string; Name: string };
  To?: Array<{ Address: string; Name: string }>;
  Subject: string;
  Created: string;
  Read?: boolean;
  Tags?: string[];
}

interface MailpitMessageDetail extends MailpitMessage {
  Headers?: Record<string, string[]>;
}

interface MailpitListResponse {
  messages?: MailpitMessage[];
  total?: number;
  unread?: number;
  count?: number;
}

@Injectable()
export class MailpitTrackerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(MailpitTrackerService.name);
  private timer: NodeJS.Timeout | null = null;
  private stopRequested = false;

  constructor(
    private readonly redis: RedisService,
    private readonly prismaBypass: PrismaBypassRlsService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.NODE_ENV !== 'development') return;
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    this.stopRequested = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext(): void {
    if (this.stopRequested) return;
    this.timer = setTimeout(() => {
      void this.pollOnce()
        .catch((err) => this.log.warn({ err: String(err) }, 'mailpit poll error'))
        .finally(() => this.scheduleNext());
    }, POLL_INTERVAL_MS);
  }

  /**
   * Visible para tests. Una iteración del polling.
   */
  async pollOnce(): Promise<{ delivered: number; opened: number }> {
    const url = `${this.env.MAILPIT_API_URL.replace(/\/+$/, '')}/api/v1/messages?query=tag%3Acert&limit=50`;
    let listJson: MailpitListResponse;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        this.log.warn({ status: res.status }, 'mailpit list failed');
        return { delivered: 0, opened: 0 };
      }
      listJson = (await res.json()) as MailpitListResponse;
    } catch (err) {
      this.log.warn({ err: String(err) }, 'mailpit fetch error (¿está arriba?)');
      return { delivered: 0, opened: 0 };
    }

    const messages = listJson.messages ?? [];
    let delivered = 0;
    let opened = 0;
    for (const msg of messages) {
      const seenKey = `${REDIS_PREFIX}${msg.ID}`;
      const seen = await this.redis.get(seenKey);
      if (!seen) {
        // Nuevo mensaje: registramos delivered.
        const certId = await this.extractCertId(msg);
        if (certId) {
          await this.persist(certId, 'delivered', msg);
          delivered += 1;
        }
        await this.redis.set(seenKey, JSON.stringify({ delivered: true, at: Date.now() }), SEEN_TTL_SECONDS);
      }
      if (msg.Read === true) {
        const openedKey = `${seenKey}:opened`;
        const alreadyOpened = await this.redis.get(openedKey);
        if (!alreadyOpened) {
          const certId = await this.extractCertId(msg);
          if (certId) {
            await this.persist(certId, 'opened', msg);
            opened += 1;
          }
          await this.redis.set(openedKey, '1', SEEN_TTL_SECONDS);
        }
      }
    }
    if (delivered + opened > 0) {
      this.log.debug({ delivered, opened }, 'mailpit synced');
    }
    return { delivered, opened };
  }

  /**
   * Lee detalle del mensaje (headers) para extraer `X-Tag-cert: <uuid>`.
   * Mailpit lista no incluye headers; toca un GET extra.
   */
  private async extractCertId(msg: MailpitMessage): Promise<string | null> {
    try {
      const url = `${this.env.MAILPIT_API_URL.replace(/\/+$/, '')}/api/v1/message/${msg.ID}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const detail = (await res.json()) as MailpitMessageDetail;
      const headers = detail.Headers ?? {};
      const tagCert = headers['X-Tag-Cert'] ?? headers['X-Tag-cert'] ?? headers['x-tag-cert'];
      if (Array.isArray(tagCert) && tagCert.length > 0 && typeof tagCert[0] === 'string') {
        return tagCert[0];
      }
      return null;
    } catch {
      return null;
    }
  }

  private async persist(
    certId: string,
    eventType: 'delivered' | 'opened',
    msg: MailpitMessage,
  ): Promise<void> {
    const cert = await this.prismaBypass.client.certificate.findFirst({
      where: { id: certId },
      select: { id: true, tenantId: true },
    });
    if (!cert) return;
    const recipient = msg.To?.[0]?.Address ?? 'unknown';
    const occurredAt = msg.Created ? new Date(msg.Created) : new Date();
    await this.prismaBypass.client.emailEvent.create({
      data: {
        tenantId: cert.tenantId,
        certificateId: cert.id,
        eventType,
        recipient,
        occurredAt,
        messageId: msg.MessageID,
        detail: { source: 'mailpit-tracker', mailpitId: msg.ID },
      },
    });
  }
}
