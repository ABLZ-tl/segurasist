import {
  Injectable,
  Logger,
  NotImplementedException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { GENESIS_HASH, computeRowHash } from './audit-hash';
import { emitAuditMetric } from './audit-metrics-emf';

/** Resultado de `verifyChain`. */
export interface AuditChainVerification {
  valid: boolean;
  /** ID de la primera fila donde la cadena se rompe (si valid=false). */
  brokenAtId?: string;
  /** Total de filas evaluadas para el tenant. */
  totalRows: number;
}

/**
 * Discrepancia detectada en `verifyChain(source='both')` — una fila existe
 * en DB y/o S3 con `row_hash` distinto, o una fila falta en uno de los
 * lados. El cliente puede usar esta info para forensics.
 */
export interface AuditChainDiscrepancy {
  rowId: string;
  /** Razón legible: `'row_hash_mismatch' | 'missing_in_s3' | 'missing_in_db'`. */
  reason: 'row_hash_mismatch' | 'missing_in_s3' | 'missing_in_db';
  db?: { rowHash: string };
  s3?: { rowHash: string };
}

/**
 * Resultado extendido de `verifyChain` cuando se pide cross-source check.
 * Compatible con `AuditChainVerification` para clientes que sólo miran
 * `valid` y `totalRows`.
 */
export interface AuditChainVerificationExtended extends AuditChainVerification {
  source: 'db' | 's3' | 'both';
  /** Solo presente en `source='both'`. Lista de filas con discrepancia. */
  discrepancies?: AuditChainDiscrepancy[];
  checkedAt: string;
}

/**
 * Evento estructurado que la API quiere persistir en `audit_log`.
 *
 * `payloadDiff` es JSON arbitrario; el llamador (interceptor) ya hizo el
 * scrubbing de secretos antes de invocar `record(...)`.
 */
/**
 * H-01 — `AuditEventAction` agrupa los valores válidos del enum DB
 * `AuditAction`. Mantener sincronizado con `prisma/schema.prisma` y las
 * migraciones:
 *   - `20260428_audit_action_enum_extend` (Sprint 3 H-01): otp_requested,
 *     otp_verified, read_viewed, read_downloaded, export_downloaded.
 *   - `20260429_audit_action_sprint4_extend` (Sprint 4 S10): chatbot_message_sent,
 *     chatbot_escalated, report_generated, report_downloaded,
 *     monthly_report_sent.
 *
 * Estos valores reemplazan el "overload" semántico previo donde los services
 * codificaban el sub-action en `resourceType='auth.otp.requested'` o
 * `payloadDiff.subAction`. Migración de callers:
 *   - F6 iter 2: OTP / read+download.
 *   - S5 iter 2: chatbot_message_sent (KbService.processMessage).
 *   - S6 iter 2 (pendiente): chatbot_escalated (escalation.service).
 *   - S1 iter 2 (pendiente): report_generated, report_downloaded.
 *   - S3 iter 2 (pendiente): monthly_report_sent (monthly-reports-handler).
 */
export type AuditEventAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'read'
  | 'login'
  | 'logout'
  | 'export'
  | 'reissue'
  | 'otp_requested'
  | 'otp_verified'
  | 'read_viewed'
  | 'read_downloaded'
  | 'export_downloaded'
  | 'chatbot_message_sent'
  | 'chatbot_escalated'
  | 'report_generated'
  | 'report_downloaded'
  | 'monthly_report_sent';

export interface AuditEvent {
  tenantId: string;
  actorId?: string;
  action: AuditEventAction;
  resourceType: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  payloadDiff?: Record<string, unknown> | unknown[] | null;
  traceId?: string;
}

/**
 * S3-08 — Contexto request-only de un override de tenant. Lo consume
 * `recordOverrideUse(...)` para construir el payloadDiff del evento
 * `tenant.override.used`.
 */
export interface TenantOverrideUseContext {
  actorId: string;
  overrideTenant: string;
  ip?: string;
  userAgent?: string;
  requestPath: string;
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

    if (!this.client) {
      // F6 iter 2 — sin BD configurada el writer está en modo pino-only;
      // semánticamente NO es "degraded" (es config esperada en dev sin
      // DATABASE_URL_AUDIT). No emitimos health metric aquí: la alarma
      // se calibra contra la cardinalidad de events normales en prod.
      return;
    }

    const client = this.client;

    try {
      // Hash chain: la fila a insertar debe enlazar con la fila previa más
      // reciente del MISMO tenant. Hacemos SELECT ... FOR UPDATE dentro de
      // una transacción para serializar writes concurrentes del mismo tenant
      // (dos requests paralelos del mismo tenant insertando en milisegundos).
      //
      // Para tenants distintos no hay contención: el lock filtra por tenant_id.
      await client.$transaction(async (tx) => {
        const prev = await tx.$queryRaw<Array<{ row_hash: string }>>(
          Prisma.sql`SELECT row_hash FROM audit_log
                     WHERE tenant_id = ${event.tenantId}::uuid
                     ORDER BY occurred_at DESC, id DESC
                     LIMIT 1
                     FOR UPDATE`,
        );
        const prevHash = prev.length > 0 && prev[0] ? prev[0].row_hash : GENESIS_HASH;

        // occurredAt: usamos `new Date()` aquí porque la fila aún no existe;
        // pasamos el mismo timestamp al `data` y al hash, sincronizándolos.
        // Importante: si dejáramos que Postgres asigne `occurred_at = now()`
        // como default, el hash computado en app sería distinto al timestamp
        // persisted (clock skew app↔db). Lo seteamos explícito.
        const occurredAt = new Date();

        const rowHash = computeRowHash({
          prevHash,
          tenantId: event.tenantId,
          actorId: event.actorId ?? null,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId ?? null,
          payloadDiff: event.payloadDiff ?? null,
          occurredAt,
        });

        await tx.auditLog.create({
          data: {
            tenantId: event.tenantId,
            actorId: event.actorId ?? null,
            // Bridge cast vía `unknown`: el cliente Prisma generado se
            // regenera contra `schema.prisma` después de aplicar la migración
            // `20260429_audit_action_sprint4_extend`. Hasta que `prisma generate`
            // corra en CI/dev, el tipo Prisma local NO incluye los nuevos
            // valores (chatbot_message_sent, chatbot_escalated, …) — pero el
            // enum DB sí. El cast es seguro: `AuditEventAction` (definido en
            // este módulo) es el source of truth y se mantiene sincronizado
            // con `schema.prisma`. Tras el primer `prisma generate` en CI el
            // cast se vuelve identitario sin cambio en runtime; podemos
            // colapsarlo a `event.action` en un follow-up post-deploy.
            action: event.action as unknown as Prisma.AuditLogCreateInput['action'],
            resourceType: event.resourceType,
            resourceId: event.resourceId ?? null,
            ip: event.ip ?? null,
            userAgent: event.userAgent ?? null,
            payloadDiff: (event.payloadDiff as Prisma.InputJsonValue | null | undefined) ?? Prisma.JsonNull,
            traceId: event.traceId ?? null,
            occurredAt,
            prevHash,
            rowHash,
          },
        });
      });
      // F6 iter 2 — EMF metric `AuditWriterHealth=1` por write exitoso.
      // F8 alarma en `Sum < 1 over 5m` detecta corte total del writer.
      emitAuditMetric('AuditWriterHealth', 1);
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
      // F6 iter 2 — EMF metric `AuditWriterHealth=0` por write fallido.
      // Permite a F8 calcular ratio fail/total y disparar alarma cuando
      // exceda umbral (ej. >5% en 5m).
      emitAuditMetric('AuditWriterHealth', 0);
    }
  }

  /**
   * S3-08 — Registra el uso del header `X-Tenant-Override` por un superadmin.
   *
   * Persiste un evento `read` con `resourceType='tenant.override'` cuyo
   * `payloadDiff` documenta:
   *   { _overrideTenant, _overriddenBy: 'admin_segurasist', requestPath }
   *
   * El `tenantId` del row es el del tenant impersonado — esto permite que la
   * vista 360 del tenant (filtrada por su `tenant_id`) muestre los accesos
   * cross-tenant del superadmin. El actor es el superadmin (no el tenant).
   *
   * Llamado por:
   *   - `AuditInterceptor` indirecto: para mutaciones, las que ya emite el
   *     interceptor estándar contienen `_overrideTenant` en su payloadDiff.
   *   - `TenantOverrideAuditInterceptor`: para reads (GET/HEAD), donde el
   *     interceptor estándar no escribe nada.
   */
  async recordOverrideUse(ctx: TenantOverrideUseContext): Promise<void> {
    await this.record({
      tenantId: ctx.overrideTenant,
      actorId: ctx.actorId,
      action: 'read',
      resourceType: 'tenant.override',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      payloadDiff: {
        event: 'tenant.override.used',
        _overrideTenant: ctx.overrideTenant,
        _overriddenBy: 'admin_segurasist',
        requestPath: ctx.requestPath,
      },
      traceId: ctx.traceId,
    });
  }

  /**
   * Verifica la integridad de la cadena de hashes para un tenant. Lee todas
   * las filas ordenadas por (occurred_at, id) y recomputa cada `row_hash`
   * desde el génesis. Detecta:
   *   - Tampering en cualquier campo (cambio de payloadDiff, action, etc).
   *   - prev_hash que no matchee el row_hash de la fila anterior.
   *   - row_hash adulterado.
   *
   * Devuelve la primera fila rota como `brokenAtId`. Si todas las filas
   * verifican, `valid=true`.
   */
  async verifyChain(tenantId: string): Promise<AuditChainVerification> {
    if (!this.client) {
      throw new NotImplementedException(
        'AuditWriter sin BD configurada (DATABASE_URL_AUDIT ausente); verify-chain no aplicable.',
      );
    }
    const rows = await this.client.auditLog.findMany({
      where: { tenantId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    return runVerification(rows);
  }

  /**
   * Devuelve las filas del audit_log de un tenant en orden cronológico — para
   * que `AuditChainVerifierService` pueda hacer cross-check fila a fila contra
   * la copia en S3. Incluye `mirroredToS3` para que el cross-check ignore las
   * filas aún no replicadas (mirror eventual de 60s).
   */
  async verifyChainRows(tenantId: string): Promise<{
    rows: Array<{
      id: string;
      tenantId: string;
      actorId: string | null;
      action: string;
      resourceType: string;
      resourceId: string | null;
      payloadDiff: unknown;
      occurredAt: Date;
      prevHash: string;
      rowHash: string;
      mirroredToS3: boolean;
    }>;
  }> {
    if (!this.client) {
      throw new NotImplementedException(
        'AuditWriter sin BD configurada (DATABASE_URL_AUDIT ausente); verify-chain no aplicable.',
      );
    }
    const rows = await this.client.auditLog.findMany({
      where: { tenantId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        actorId: r.actorId,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        payloadDiff: r.payloadDiff,
        occurredAt: r.occurredAt,
        prevHash: r.prevHash,
        rowHash: r.rowHash,
        mirroredToS3: r.mirroredToS3,
      })),
    };
  }
}

/**
 * Forma mínima de fila aceptada por `runVerification`. Cualquier fuente
 * (DB, S3 mirror parseado a Date, fakes en tests) que pueda proveer estos
 * campos sirve. Exportamos el tipo para que callers (e.g. el verifier
 * cross-source) pasen rows tipados sin duplicar la signature.
 */
export interface AuditChainVerifiableRow {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  payloadDiff: unknown;
  occurredAt: Date;
  prevHash: string;
  rowHash: string;
}

/**
 * Recomputa la cadena hash completa para un set de filas:
 *   1. `prev_hash` debe matchear el `row_hash` de la fila previa (o GENESIS
 *      en la primera fila).
 *   2. `row_hash` debe matchear el SHA-256 recomputado a partir de los
 *      campos persistidos (prev_hash, tenantId, actorId, action,
 *      resourceType, resourceId, payloadDiff canónico, occurredAt).
 *
 * Detecta tampering coordinado donde un atacante con BYPASSRLS modifica
 * `payloadDiff` Y regenera `row_hash` matching: si solo modificó esa fila
 * pero no las subsiguientes, la cadena se rompe en la siguiente fila
 * (`prev_hash` ya no matchea el nuevo `row_hash`). Si recomputó toda la
 * cadena coordinadamente, lo detecta el cross-check DB↔S3 mirror que
 * Object Lock COMPLIANCE protege como ground-truth.
 *
 * Exportada para que `AuditChainVerifierService` la use en lugar del
 * "light path" que solo encadenaba `prev_hash` (C-10 fix).
 */
export function runVerification(
  rows: Array<AuditChainVerifiableRow>,
): AuditChainVerification {
  let prevExpected = GENESIS_HASH;
  for (const row of rows) {
    // 1) prev_hash debe matchear el row_hash de la fila previa (o GENESIS).
    if (row.prevHash !== prevExpected) {
      return { valid: false, brokenAtId: row.id, totalRows: rows.length };
    }
    // 2) row_hash debe matchear el recompute de los campos persistidos.
    const recomputed = computeRowHash({
      prevHash: row.prevHash,
      tenantId: row.tenantId,
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      // payloadDiff puede ser null o JsonValue. Normalizamos null para que
      // el canonical JSON matchee el insert (que pasó `event.payloadDiff ?? null`).
      payloadDiff: row.payloadDiff ?? null,
      occurredAt: row.occurredAt,
    });
    if (recomputed !== row.rowHash) {
      return { valid: false, brokenAtId: row.id, totalRows: rows.length };
    }
    prevExpected = row.rowHash;
  }
  return { valid: true, totalRows: rows.length };
}
