import { AuditWriterService } from '@modules/audit/audit-writer.service';
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, Optional } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Observable, tap } from 'rxjs';

/**
 * S3-08 — TenantOverrideAuditInterceptor
 *
 * Cuando el `JwtAuthGuard` setea `req.tenantOverride.active = true`
 * (admin_segurasist enviando `X-Tenant-Override`), persiste un evento
 * `tenant.override.used` en `audit_log` para CADA request — incluidas las
 * GET/HEAD/OPTIONS (que el `AuditInterceptor` estándar ignora porque ahí
 * sólo persiste mutaciones).
 *
 * Para mutaciones, el `AuditInterceptor` ya añade `_overrideTenant` /
 * `_overriddenBy` al payloadDiff de la fila de la operación principal — este
 * interceptor NO duplica esa fila para mutaciones (sólo emite la fila
 * `tenant.override.used` extra para reads, donde no hay otra alternativa).
 *
 * Orden de ejecución: este interceptor se aplica a nivel APP_INTERCEPTOR
 * después del `AuditInterceptor` (Nest ejecuta interceptores en el orden de
 * declaración en `app.module.ts`).
 */
@Injectable()
export class TenantOverrideAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('audit.override');

  constructor(@Optional() private readonly writer?: AuditWriterService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<
      FastifyRequest & {
        user?: { id: string };
        tenantOverride?: { active: boolean; overrideTenant: string };
      }
    >();
    const isReadOnly = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';

    return next.handle().pipe(
      tap(() => {
        const ovr = req.tenantOverride;
        if (!ovr?.active) return;
        // Mutaciones ya quedan registradas con _overrideTenant en su propio
        // row (vía AuditInterceptor estándar). Para evitar duplicar el
        // registro, sólo emitimos `tenant.override.used` en reads.
        if (!isReadOnly) return;
        const actorId = req.user?.id;
        if (!actorId) return;
        const ip = (req.ip || '').toString() || undefined;
        const userAgent = req.headers['user-agent'] ?? undefined;
        const traceId = (req.id as string | undefined) ?? undefined;

        // Log siempre (CloudWatch source-of-truth).
        this.logger.log({
          audit: true,
          event: 'tenant.override.used',
          actorId,
          overrideTenant: ovr.overrideTenant,
          ip,
          userAgent,
          traceId,
          requestPath: req.url,
          method: req.method,
        });

        // Fire-and-forget: el writer captura sus propios errores.
        if (this.writer) {
          void this.writer.recordOverrideUse({
            actorId,
            overrideTenant: ovr.overrideTenant,
            ip,
            userAgent,
            requestPath: req.url,
            traceId,
          });
        }
      }),
    );
  }
}
