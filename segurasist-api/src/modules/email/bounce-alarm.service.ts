/**
 * Bounce-rate alarm. Si en las últimas 24h `bounce_rate > 5%`, persiste
 * `system_alerts` P2 + log warning. NO bloquea envíos en MVP, sólo alerta.
 *
 * Uso: el `EmailWorkerService` puede llamar `checkAndAlert()` después de
 * cada send (best-effort, no en hot path), o un cron Sprint 5+ corre
 * periodicamente.
 */
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { Injectable, Logger } from '@nestjs/common';

const BOUNCE_RATE_THRESHOLD = 0.05;

@Injectable()
export class BounceAlarmService {
  private readonly log = new Logger(BounceAlarmService.name);

  constructor(private readonly prismaBypass: PrismaBypassRlsService) {}

  /**
   * Calcula bounce_rate en últimas 24h por tenant. Si excede 5%, registra
   * un alert P2 (idempotente: si ya hay un alert sin resolver hoy para el
   * mismo tenant, no duplica).
   */
  async checkAndAlert(tenantId: string): Promise<{ rate: number; alerted: boolean }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const totalSent = await this.prismaBypass.client.emailEvent.count({
      where: { tenantId, eventType: 'sent', occurredAt: { gte: since } },
    });
    if (totalSent === 0) return { rate: 0, alerted: false };
    const totalBounced = await this.prismaBypass.client.emailEvent.count({
      where: { tenantId, eventType: 'bounced', occurredAt: { gte: since } },
    });
    const rate = totalBounced / totalSent;
    if (rate <= BOUNCE_RATE_THRESHOLD) return { rate, alerted: false };

    // Idempotencia: si ya existe alert hoy sin resolver, no duplicamos.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const existing = await (
      this.prismaBypass.client as unknown as {
        systemAlert: {
          findFirst: (args: unknown) => Promise<unknown>;
          create: (args: unknown) => Promise<unknown>;
        };
      }
    ).systemAlert.findFirst({
      where: {
        tenantId,
        code: 'EMAIL_BOUNCE_RATE_HIGH',
        resolvedAt: null,
        occurredAt: { gte: todayStart },
      },
    });
    if (existing) return { rate, alerted: false };

    await (
      this.prismaBypass.client as unknown as {
        systemAlert: { create: (args: unknown) => Promise<unknown> };
      }
    ).systemAlert.create({
      data: {
        tenantId,
        severity: 'P2',
        code: 'EMAIL_BOUNCE_RATE_HIGH',
        message: `Bounce rate ${Math.round(rate * 100)}% en últimas 24h (umbral 5%)`,
        context: { rate, totalSent, totalBounced, windowHours: 24 },
      },
    });
    this.log.warn({ tenantId, rate, totalSent, totalBounced }, 'P2 alert: email bounce rate > 5%');
    return { rate, alerted: true };
  }
}
