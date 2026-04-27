/**
 * S3-09 — Custom guard que enforza el cap diario de exports por tenant.
 *
 * El throttler global (Redis-based) ya cubre 1/min por user via @Throttle.
 * Este guard agrega una segunda capa: 10 exports/día por TENANT (cualquier
 * user). El conteo se hace en DB (no en Redis) por dos razones:
 *
 *   1. Persistencia: si Redis se vacía / reinicia, el cap se mantiene
 *      porque las filas `exports` viven en Postgres.
 *   2. Forensics: el audit log + la tabla exports ya guardan el histórico;
 *      el guard recicla esa fuente de verdad en lugar de duplicar contadores.
 *
 * Trade-off: agrega ~5-15ms de latencia (un COUNT con índice
 * `exports_tenant_status_idx`). Aceptable para un endpoint cuyo SLA es
 * "máximo 1/min por user". El guard SE EJECUTA después del throttler global,
 * así que un user en burst ya está cortado antes de llegar acá.
 *
 * Tenant resolution: lee `req.tenant.id` (lo pobló JwtAuthGuard). Si no hay
 * tenant context (p.ej. superadmin sin tenant) → bypass (no aplica cap).
 */
import type { TenantCtx } from '@common/decorators/tenant.decorator';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/** Cap diario por tenant. */
export const EXPORT_DAILY_CAP_PER_TENANT = 10;
/** Ventana de 24h. */
export const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ExportRateLimitGuard implements CanActivate {
  private readonly log = new Logger(ExportRateLimitGuard.name);

  constructor(private readonly bypass: PrismaBypassRlsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    // Kill switch alineado con el throttler global. Útil para tests e2e.
    const enabledRaw = process.env.THROTTLE_ENABLED;
    if (enabledRaw === 'false' || enabledRaw === '0') return true;

    const req = context.switchToHttp().getRequest<FastifyRequest & { tenant?: TenantCtx }>();
    const tenantId = req.tenant?.id;
    if (!tenantId) {
      // Sin tenant context (superadmin global): bypass del cap diario.
      return true;
    }

    if (!this.bypass.isEnabled()) {
      // Modo dev sin DATABASE_URL_BYPASS: degradamos a fail-open con warning.
      // En prod la env var es obligatoria; este path no se ejecuta.
      this.log.warn(
        { tenantId },
        'PrismaBypassRlsService deshabilitado; ExportRateLimitGuard hace fail-open',
      );
      return true;
    }

    const since = new Date(Date.now() - EXPORT_WINDOW_MS);
    // Conteo cross-status: pending + processing + ready cuentan, failed no
    // (un job fallido no debería gastar cuota; el user debe poder reintentar).
    const count = await this.bypass.client.export.count({
      where: {
        tenantId,
        requestedAt: { gte: since },
        status: { in: ['pending', 'processing', 'ready'] },
      },
    });

    if (count >= EXPORT_DAILY_CAP_PER_TENANT) {
      this.log.warn(
        { tenantId, count, cap: EXPORT_DAILY_CAP_PER_TENANT },
        'export daily cap exceeded for tenant',
      );
      throw new HttpException(
        {
          message: `Has alcanzado el límite de ${EXPORT_DAILY_CAP_PER_TENANT} exportaciones diarias para tu organización. Intenta mañana o contacta soporte.`,
          retryAfterSeconds: 3600,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
