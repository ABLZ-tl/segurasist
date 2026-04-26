import { Readable } from 'node:stream';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
} from '@aws-sdk/client-s3';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Mirror inmutable del audit_log a S3 (Sprint 2 — story S2-07).
 *
 * Defensa en profundidad: Postgres es restorable (no inmutable). Espejamos
 * cada fila del audit_log a un bucket S3 con Object Lock COMPLIANCE 730 días
 * (LocalStack en dev, S3 mx-central-1 en Sprint 5). En modo COMPLIANCE NI EL
 * ROOT account puede borrar/sobrescribir un objeto antes de que expire la
 * retención — eso cierra el riesgo de tampering posterior por DBA o por
 * actor con acceso al filesystem subyacente.
 *
 * Estrategia: **batched async**. Cada minuto:
 *   1. SELECT FROM audit_log WHERE mirrored_to_s3=false LIMIT N (partial index).
 *   2. Agrupa por (tenantId, fecha UTC) — un objeto NDJSON por (tenant, día).
 *   3. PUT s3://<bucket>/audit/{tenantId}/{YYYY}/{MM}/{DD}/{batchId}.ndjson
 *      con SSE-KMS (alias/segurasist-dev) y default Object Lock retention.
 *   4. UPDATE audit_log SET mirrored_to_s3=true, mirrored_at=now() WHERE id IN (...)
 *
 * Garantías:
 *   - **No pierde filas**: si S3 falla, mirrored_to_s3 sigue false → reintenta
 *     en el próximo tick. La integridad de la cadena hash en Postgres queda
 *     intacta independientemente del resultado del mirror.
 *   - **No bloquea writes**: el AuditWriterService no espera al mirror;
 *     mirrored_to_s3 default false en INSERT.
 *   - **Append-only en S3**: cada batch es un objeto distinto (batchId =
 *     timestamp UTC en ISO compacto). Nunca sobrescribimos un NDJSON
 *     existente — si por error intentáramos, S3 con Object Lock COMPLIANCE
 *     responde AccessDenied.
 *
 * Formato NDJSON (una fila por línea, JSON canónico):
 *   {"id":"<uuid>","tenantId":"<uuid>","actorId":"<uuid|null>","action":"<...>",
 *    "resourceType":"<...>","resourceId":"<...|null>","ip":"<...|null>",
 *    "userAgent":"<...|null>","payloadDiff":<json|null>,"traceId":"<...|null>",
 *    "occurredAt":"<ISO-8601>","prevHash":"<hex64>","rowHash":"<hex64>"}
 *
 * Esto matchea `Prisma.AuditLog` field-by-field y permite que `verifyChain`
 * con source=s3 reconstruya la cadena hash exactamente como en BD.
 */
@Injectable()
export class AuditS3MirrorService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AuditS3MirrorService.name);
  private readonly client: PrismaClient | null;
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly kmsKeyId: string;
  /**
   * Tamaño máximo del batch — protege contra spikes que harían un PUT de
   * varios MB. 1000 filas ≈ 0.5 MB típico (cada fila <500B canónico).
   */
  private readonly batchLimit: number;
  private readonly intervalMs: number;
  /** setInterval handle (si activo). En tests se desactiva para llamar
   *  `runOnce()` deterministico. */
  private timer: NodeJS.Timeout | undefined;
  /** Lock de re-entrancia: evita que dos ticks superpuestos compitan por
   *  el mismo set de filas (puede pasar si un tick supera el intervalo). */
  private running = false;

  constructor(@Inject(ENV_TOKEN) env: Env, @Optional() prisma?: PrismaClient, @Optional() s3?: S3Client) {
    this.bucket = env.S3_BUCKET_AUDIT;
    this.kmsKeyId = env.KMS_KEY_ID;
    this.batchLimit = Number(process.env.AUDIT_MIRROR_BATCH_LIMIT ?? 1000);
    this.intervalMs = Number(process.env.AUDIT_MIRROR_INTERVAL_MS ?? 60_000);

    if (prisma) {
      this.client = prisma;
    } else {
      const url = process.env.DATABASE_URL_AUDIT;
      if (!url) {
        this.log.warn(
          'DATABASE_URL_AUDIT ausente: AuditS3MirrorService deshabilitado (no hay BD para leer audit_log).',
        );
        this.client = null;
      } else {
        this.client = new PrismaClient({
          datasources: { db: { url } },
          log: ['warn', 'error'],
        });
      }
    }

    this.s3 =
      s3 ??
      new S3Client({
        region: env.AWS_REGION,
        ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL, forcePathStyle: true } : {}),
      });
  }

  async onModuleInit(): Promise<void> {
    if (this.client) {
      try {
        await this.client.$connect();
      } catch (err) {
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'AuditS3MirrorService: $connect falló, mirror deshabilitado en runtime',
        );
      }
    }

    // Tests deshabilitan el timer (NODE_ENV=test) — controlan el tick con
    // `runOnce()`. En dev/staging/prod el cron arranca al boot. Si la app
    // se inicia con AWS_ENDPOINT_URL apuntando a LocalStack y LocalStack
    // está abajo, el primer tick falla silenciosamente y se reintenta al
    // próximo intervalo (no bloquea boot).
    if (process.env.NODE_ENV !== 'test' && process.env.AUDIT_MIRROR_DISABLED !== '1') {
      this.startTimer();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopTimer();
    if (this.client) {
      try {
        await this.client.$disconnect();
      } catch {
        // ignorar
      }
    }
  }

  /** Para tests + ops manual. Loguea pero no propaga errores. */
  startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((err) => {
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'AuditS3MirrorService.runOnce tick failed',
        );
      });
    }, this.intervalMs);
    // unref() para no bloquear shutdown del proceso si el timer está pendiente.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Ejecuta un ciclo de mirror. Devuelve métricas para tests / observabilidad.
   * Idempotente: si no hay filas pendientes devuelve `{batches:0, rows:0}`.
   *
   * Nunca lanza al caller — los errores se loguean y la fila queda pendiente
   * (mirrored_to_s3=false) para el próximo tick.
   */
  async runOnce(): Promise<{ batches: number; rows: number; failedBatches: number }> {
    if (!this.client) return { batches: 0, rows: 0, failedBatches: 0 };
    if (this.running) {
      this.log.debug('AuditS3MirrorService.runOnce: tick previo aún corriendo, skip');
      return { batches: 0, rows: 0, failedBatches: 0 };
    }
    this.running = true;
    try {
      // Lee filas pendientes ordenadas por (tenant, occurredAt) — el orden
      // garantiza que dentro de un mismo tenant los NDJSON respetan el orden
      // del hash chain. Para tenants distintos el orden no importa.
      const pending = await this.client.auditLog.findMany({
        where: { mirroredToS3: false },
        orderBy: [{ tenantId: 'asc' }, { occurredAt: 'asc' }, { id: 'asc' }],
        take: this.batchLimit,
      });
      if (pending.length === 0) return { batches: 0, rows: 0, failedBatches: 0 };

      // Agrupar por (tenantId, fecha UTC). Un solo objeto S3 por grupo →
      // append-only friendly + facilita listing por rango de fechas.
      const groups = new Map<string, typeof pending>();
      for (const row of pending) {
        const ymd = ymdUtc(row.occurredAt);
        const key = `${row.tenantId}:${ymd}`;
        const arr = groups.get(key);
        if (arr) arr.push(row);
        else groups.set(key, [row]);
      }

      let okBatches = 0;
      let failedBatches = 0;
      let okRows = 0;
      const successfullyMirroredIds: string[] = [];

      for (const [groupKey, rows] of groups.entries()) {
        const [tenantId, ymd] = groupKey.split(':') as [string, string];
        const [yyyy, mm, dd] = ymd.split('-') as [string, string, string];
        // batchId: ISO compacto sin separadores → ordenable lexicográficamente
        // y único por tick (resolución milisegundo).
        const batchId = new Date()
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.(\d{3})Z$/, '$1Z');
        const objectKey = `audit/${tenantId}/${yyyy}/${mm}/${dd}/${batchId}.ndjson`;
        const ndjson = rows.map((r) => JSON.stringify(serializeAuditRow(r))).join('\n') + '\n';

        try {
          await this.s3.send(
            new PutObjectCommand({
              Bucket: this.bucket,
              Key: objectKey,
              Body: Buffer.from(ndjson, 'utf-8'),
              ContentType: 'application/x-ndjson',
              ServerSideEncryption: 'aws:kms',
              SSEKMSKeyId: this.kmsKeyId,
              // Object Lock: confiamos en el default retention COMPLIANCE 730d
              // del bucket; no override per-object aquí. Si el bucket no tiene
              // default retention y querés enforce per-object, pasar también
              // ObjectLockMode + ObjectLockRetainUntilDate. Decisión: dejamos
              // default-bucket porque facilita rotación de política sin reupload.
            }),
          );
          okBatches += 1;
          okRows += rows.length;
          successfullyMirroredIds.push(...rows.map((r) => r.id));
        } catch (err) {
          failedBatches += 1;
          this.log.warn(
            {
              err: err instanceof Error ? err.message : String(err),
              tenantId,
              ymd,
              batchSize: rows.length,
              objectKey,
            },
            'AuditS3MirrorService: PUT NDJSON falló — filas quedan pendientes para retry',
          );
        }
      }

      // Mark mirrored sólo las filas cuyo batch tuvo éxito en S3. Si
      // failedBatches>0, esas filas siguen mirrored_to_s3=false → próximo tick
      // las reintenta.
      if (successfullyMirroredIds.length > 0) {
        await this.client.auditLog.updateMany({
          where: { id: { in: successfullyMirroredIds } },
          data: { mirroredToS3: true, mirroredAt: new Date() },
        });
      }

      return { batches: okBatches, rows: okRows, failedBatches };
    } finally {
      this.running = false;
    }
  }

  /**
   * Lee todos los NDJSON del tenant en S3 y devuelve las filas (parseadas)
   * en orden cronológico — usado por `verifyChain(source=s3|both)`.
   *
   * NOTA: descarga + parse en memoria. Para tenants con millones de filas
   * convendría stream-parse; suficiente para MVP (cada tenant se espera
   * <100k filas/año).
   */
  async readAllForTenant(tenantId: string): Promise<MirroredAuditRow[]> {
    const prefix = `audit/${tenantId}/`;
    const keys: string[] = [];
    let token: string | undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const resp = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      const items = resp.Contents ?? [];
      for (const it of items) {
        if (it.Key) keys.push(it.Key);
      }
      if (!resp.IsTruncated) break;
      token = resp.NextContinuationToken;
    }
    // Ordenar lexicográficamente por key — `audit/{tenant}/YYYY/MM/DD/batchId.ndjson`
    // resulta cronológico porque YYYY/MM/DD/ISO-batchId comparte ese orden.
    keys.sort((a, b) => a.localeCompare(b));

    const rows: MirroredAuditRow[] = [];
    for (const k of keys) {
      const obj = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: k }));
      const body = obj.Body as Readable | undefined;
      if (!body) continue;
      const text = await streamToString(body);
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          rows.push(JSON.parse(trimmed) as MirroredAuditRow);
        } catch (err) {
          this.log.warn(
            { err: err instanceof Error ? err.message : String(err), key: k, snippet: trimmed.slice(0, 80) },
            'AuditS3MirrorService.readAllForTenant: línea NDJSON inválida — skip',
          );
        }
      }
    }

    // Re-sort por (occurredAt, id) — el orden lexicográfico de keys ya
    // garantiza el orden inter-batch, pero dos batches del mismo día con
    // batchIds distintos podrían intercalarse. Sort estable cierra el caso.
    rows.sort((a, b) => {
      const ta = new Date(a.occurredAt).getTime();
      const tb = new Date(b.occurredAt).getTime();
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });
    return rows;
  }

  /** Para introspección de tests. */
  isRunning(): boolean {
    return this.running;
  }
}

/** Forma serializable canónica de una fila audit_log para NDJSON. */
export interface MirroredAuditRow {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ip: string | null;
  userAgent: string | null;
  payloadDiff: unknown;
  traceId: string | null;
  /** ISO-8601 con milisegundos. */
  occurredAt: string;
  prevHash: string;
  rowHash: string;
}

export function serializeAuditRow(r: {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ip: string | null;
  userAgent: string | null;
  payloadDiff: Prisma.JsonValue | null;
  traceId: string | null;
  occurredAt: Date;
  prevHash: string;
  rowHash: string;
}): MirroredAuditRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    actorId: r.actorId,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    ip: r.ip,
    userAgent: r.userAgent,
    payloadDiff: r.payloadDiff,
    traceId: r.traceId,
    occurredAt: r.occurredAt.toISOString(),
    prevHash: r.prevHash,
    rowHash: r.rowHash,
  };
}

function ymdUtc(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
