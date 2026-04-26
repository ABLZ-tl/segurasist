import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Observable, tap } from 'rxjs';

// AuditInterceptor: hook para que cada acción mutante se persista en `audit_log`.
// En Sprint 0 sólo registra a logger estructurado; AuditService la consumirá luego.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('audit');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const start = Date.now();
    const method = req.method;
    const url = req.url;
    const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

    return next.handle().pipe(
      tap(() => {
        if (!isMutation) return;
        const tenantId = (req as unknown as { tenant?: { id: string } }).tenant?.id;
        const actorId = (req as unknown as { user?: { id: string } }).user?.id;
        this.logger.log({
          traceId: req.id,
          tenantId,
          actorId,
          method,
          url,
          latencyMs: Date.now() - start,
        });
      }),
    );
  }
}
