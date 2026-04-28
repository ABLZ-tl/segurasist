import { scrubSensitive } from '@common/utils/scrub-sensitive';
import { AuditWriterService, type AuditEvent } from '@modules/audit/audit-writer.service';
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, Optional } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Observable, tap } from 'rxjs';

/**
 * H-01 / P3 — el interceptor consume `scrubSensitive` y `SENSITIVE_LOG_KEYS`
 * desde `@common/utils/scrub-sensitive` (lista única, depth 10). Antes
 * había una segunda lista local (depth 8) duplicada con drift.
 *
 * Mantener referencia al alias `redact` para los tests existentes
 * (`__test.redact`) que dependen del nombre histórico.
 */
const redact = (value: unknown, depth = 0): unknown => scrubSensitive(value, depth);

function methodToAction(
  method: string,
  url: string,
): 'create' | 'update' | 'delete' | 'export' | 'login' | 'logout' | 'reissue' | undefined {
  // Heurística: el método HTTP define la acción primaria. Algunas rutas
  // tienen semántica especial (login/logout/reissue) y se detectan por url.
  const u = url.toLowerCase();
  if (u.endsWith('/auth/login')) return 'login';
  if (u.endsWith('/auth/logout')) return 'logout';
  if (u.includes('/reissue')) return 'reissue';
  if (u.includes('/export') || u.includes('/reports/')) return 'export';
  switch (method.toUpperCase()) {
    case 'POST':
      return 'create';
    case 'PATCH':
    case 'PUT':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return undefined;
  }
}

function extractResourceType(url: string): string {
  // `/v1/insureds/abc/errors` → `insureds`. Coge el primer segmento después
  // del prefijo de versión. Suficiente para el MVP; el campo es VarChar(80).
  const clean = url.split('?')[0] ?? url;
  const parts = clean.split('/').filter(Boolean);
  // Saltar `v1` u otros prefijos de versión.
  const start = parts[0]?.match(/^v\d+$/) ? 1 : 0;
  return parts[start] ?? 'unknown';
}

function extractResourceId(url: string): string | undefined {
  const clean = (url.split('?')[0] ?? url).split('/').filter(Boolean);
  const idLike = clean.find((seg) =>
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(seg),
  );
  return idLike;
}

/**
 * AuditInterceptor — persiste cada mutación HTTP en `audit_log` (vía
 * AuditWriterService, fire-and-forget) y la duplica en pino.
 *
 * Reglas:
 *  - Sólo persiste mutaciones (POST/PUT/PATCH/DELETE). GET/HEAD/OPTIONS son
 *    ruido en el ledger; CloudWatch ya conserva el access log.
 *  - `payloadDiff` se construye combinando `req.body` y `req.query`, con
 *    redact recursivo de credenciales/PII.
 *  - Si `tenantId` está ausente (endpoints públicos pre-auth como login)
 *    NO persistimos en BD (la columna `tenant_id` es NOT NULL); seguimos
 *    logueando en pino con el flag `audit: true`.
 *  - Captura excepciones del response: el operador de tap NO se ejecuta si
 *    el handler tiró; usamos `finalize` no, porque queremos saber el status.
 *    Usamos `pipe(tap)` y registramos sólo cuando el response es exitoso —
 *    los errores ya quedan en pino vía HttpExceptionFilter.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('audit');

  constructor(@Optional() private readonly writer?: AuditWriterService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
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
        const ip = (req.ip || '').toString() || undefined;
        const userAgent = req.headers['user-agent'] ?? undefined;
        const traceId = (req.id as string | undefined) ?? undefined;
        // S3-08 — si el request fue marcado por el JwtAuthGuard como override,
        // enriquecemos el payloadDiff para que el row del audit_log refleje
        // explícitamente que fue una operación cross-tenant del superadmin.
        // Visible en vista 360 admin.
        const tenantOverride = (
          req as unknown as { tenantOverride?: { active: boolean; overrideTenant: string } }
        ).tenantOverride;

        const action = methodToAction(method, url);
        const resourceType = extractResourceType(url);
        const resourceId = extractResourceId(url);

        // Diff combinado body+query, redactado.
        const body = (req as unknown as { body?: unknown }).body;
        const query = (req as unknown as { query?: unknown }).query;
        const payloadDiff: Record<string, unknown> = {};
        if (body !== undefined && body !== null) payloadDiff.body = redact(body);
        if (query && Object.keys(query as Record<string, unknown>).length > 0) {
          payloadDiff.query = redact(query);
        }
        if (tenantOverride?.active === true) {
          payloadDiff._overrideTenant = tenantOverride.overrideTenant;
          payloadDiff._overriddenBy = 'admin_segurasist';
        }

        // Log a pino siempre — es la fuente de verdad para CloudWatch → S3.
        this.logger.log({
          traceId,
          tenantId,
          actorId,
          method,
          url,
          action,
          resourceType,
          resourceId,
          latencyMs: Date.now() - start,
        });

        // Persistir sólo si tenemos tenant (la columna es NOT NULL) y action.
        if (!tenantId || !action) return;

        const event: AuditEvent = {
          tenantId,
          actorId,
          action,
          resourceType,
          resourceId,
          ip,
          userAgent,
          payloadDiff: Object.keys(payloadDiff).length > 0 ? payloadDiff : null,
          traceId,
        };

        // Fire-and-forget: el writer captura sus propios errores.
        if (this.writer) {
          void this.writer.record(event);
        }
      }),
    );
  }
}

// Helpers exportados para tests unitarios del redact recursivo.
export const __test = { redact, methodToAction, extractResourceType, extractResourceId };
