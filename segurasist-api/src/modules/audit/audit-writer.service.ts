import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Evento estructurado que la API quiere persistir en `audit_log`.
 *
 * `payloadDiff` es JSON arbitrario; el llamador (interceptor) ya hizo el
 * scrubbing de secretos antes de invocar `record(...)`.
 */
export interface AuditEvent {
  tenantId: string;
  actorId?: string;
  action: 'create' | 'update' | 'delete' | 'read' | 'login' | 'logout' | 'export' | 'reissue';
  resourceType: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  payloadDiff?: Record<string, unknown> | unknown[] | null;
  traceId?: string;
}

/**
 * Cliente Prisma dedicado a la escritura de audit. Usa `DATABASE_URL_AUDIT`
 * cuando está presente para que el rol detrás (idealmente
 * `segurasist_admin` con BYPASSRLS) pueda insertar entradas para CUALQUIER
 * tenant — el actor de la petición puede no tener permiso RLS para escribir
 * audit_log directamente, especialmente en flows cross-tenant administrativos.
 *
 * Si `DATABASE_URL_AUDIT` NO está definida en env, el writer cae a modo
 * pino-only: loguea el evento estructurado pero NO lo persiste. Esto evita
 * bloquear el bootstrap antes de que se rediseñe el modelo de superadmin
 * (M2 paralelo). Cuando M2 aterrice y env.schema valide la var como
 * obligatoria, este fallback puede eliminarse.
 *
 * Persistencia es fire-and-forget: el interceptor llama `record(...)` sin
 * `await`, y nosotros capturamos cualquier excepción internamente para no
 * propagarla al pipeline HTTP. Justificación: si la BD de audit está abajo,
 * no queremos tirar respuestas 200 legítimas — preferimos perder un evento
 * de audit (que igual queda en CloudWatch via pino) que perder el request.
 */
@Injectable()
export class AuditWriterService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AuditWriterService.name);
  private readonly client: PrismaClient | null;

  constructor(@Optional() client?: PrismaClient) {
    // El cliente puede inyectarse manualmente en tests o construirse aquí
    // según la env var. Si la env var no existe, `client` queda null y el
    // writer entra en modo log-only.
    if (client) {
      this.client = client;
      return;
    }
    const url = process.env.DATABASE_URL_AUDIT;
    if (!url) {
      this.log.warn(
        'DATABASE_URL_AUDIT no está definida; AuditWriter en modo pino-only (sin persistencia). ' +
          'Configurar antes de prod. TODO: validar en env.schema cuando M2 lands.',
      );
      this.client = null;
      return;
    }
    this.client = new PrismaClient({
      datasources: { db: { url } },
      log: ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.client) {
      try {
        await this.client.$connect();
      } catch (err) {
        // No bloquear el boot: degradamos a log-only en runtime.
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'AuditWriter: $connect falló, degradando a pino-only',
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.$disconnect();
      } catch {
        // ignorar
      }
    }
  }

  /**
   * Persiste un evento de audit. Fire-and-forget.
   *
   * Devuelve una Promise que NUNCA rechaza — los errores se loguean pero no
   * se propagan. El llamador puede `await` sin riesgo (el interceptor lo
   * dispara sin await a propósito para no bloquear el response).
   */
  async record(event: AuditEvent): Promise<void> {
    // Logging pino-estructurado siempre, hasta cuando hay BD: redunda como
    // fuente de verdad para CloudWatch → S3 Object Lock (Sprint 5).
    this.log.log({ audit: true, ...event });

    if (!this.client) return;

    try {
      const data = {
        tenantId: event.tenantId,
        actorId: event.actorId ?? null,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId ?? null,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        payloadDiff: (event.payloadDiff as Prisma.InputJsonValue | null | undefined) ?? Prisma.JsonNull,
        traceId: event.traceId ?? null,
      };
      await this.client.auditLog.create({ data });
    } catch (err) {
      // Aislado del pipeline HTTP. Aún así el evento queda en CloudWatch.
      this.log.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          tenantId: event.tenantId,
          action: event.action,
          resourceType: event.resourceType,
        },
        'AuditWriter.record persist failed',
      );
    }
  }
}
