import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

/**
 * Contexto de un audit event extraído del request HTTP. Estructura
 * canónica que ALL services deben usar al llamar `auditWriter.record(...)`
 * en lugar de armar `{ip, userAgent, traceId}` ad-hoc en cada caller.
 *
 * H-01 / P3 — antes había 5 callers que construían el ctx manualmente
 * (auth.service, insureds.service, certificates.service, claims.service,
 * reports-worker), con drift entre ellos:
 *
 *   - auth.service.ts:233 omitía ip/userAgent/traceId enteramente.
 *   - claims.controller.ts NO derivaba ip/userAgent (H-24).
 *   - insureds.service.ts pasaba `ip: audit?.ip` con shape custom `audit`.
 *
 * El AuditContextFactory consolida todo: un caller HTTP toma `req` (vía
 * inyección REQUEST) y obtiene `{actorId, tenantId, ip, userAgent, traceId}`
 * con la misma extracción para todos.
 *
 * NOTA — workers NO pueden usar este factory (no hay `req`). Los workers
 * (`reports-worker.service.ts`) construyen el AuditEvent con datos del
 * SQS message + `auditWriter.record()` sin ctx HTTP.
 */
export interface AuditContext {
  actorId?: string;
  tenantId?: string;
  ip?: string;
  userAgent?: string;
  traceId?: string;
}

type RequestWithCtx = FastifyRequest & {
  user?: { id?: string; cognitoSub?: string };
  tenant?: { id?: string };
  id?: string;
};

/**
 * Factory request-scoped que consume el `FastifyRequest` y devuelve un
 * `AuditContext` listo para pasar al `AuditWriterService.record(...)`.
 *
 * Inyección típica en services controller-bound:
 *
 *   constructor(
 *     private readonly auditWriter: AuditWriterService,
 *     private readonly auditCtx: AuditContextFactory,
 *   ) {}
 *
 *   await this.auditWriter.record({
 *     ...this.auditCtx.fromRequest(),
 *     action: 'read',
 *     resourceType: 'certificates',
 *     resourceId: cert.id,
 *     payloadDiff: { subAction: 'downloaded' },
 *   });
 *
 * El factory queda en el AuditPersistenceModule (@Global) para que cualquier
 * service downstream pueda inyectarlo sin re-importar el módulo.
 */
@Injectable({ scope: Scope.REQUEST })
export class AuditContextFactory {
  constructor(@Inject(REQUEST) private readonly req: RequestWithCtx) {}

  /**
   * Devuelve el contexto canónico del request actual. Si algún campo no
   * está disponible (request pre-auth, sin tenant guard ejecutado, etc.)
   * el campo viene `undefined` — el caller decide si persistir igual
   * (`auth.service.otpRequest`) o saltar (`insureds.service` ya lo hace).
   *
   * `traceId`: prioridad header `x-trace-id` (cliente puede propagar
   * traceId distribuido); fallback `req.id` (Fastify genReqId).
   */
  fromRequest(): AuditContext {
    const ip = (this.req.ip ?? '').toString() || undefined;
    const userAgent = this.req.headers?.['user-agent'] ?? undefined;
    const headerTrace = this.req.headers?.['x-trace-id'];
    const traceId =
      (typeof headerTrace === 'string'
        ? headerTrace
        : Array.isArray(headerTrace)
          ? headerTrace[0]
          : undefined) ?? (typeof this.req.id === 'string' ? this.req.id : undefined);
    return {
      actorId: this.req.user?.id,
      tenantId: this.req.tenant?.id,
      ip,
      userAgent:
        typeof userAgent === 'string' ? userAgent : Array.isArray(userAgent) ? userAgent[0] : undefined,
      traceId,
    };
  }
}
