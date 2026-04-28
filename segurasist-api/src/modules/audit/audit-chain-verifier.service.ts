import { Injectable, Logger } from '@nestjs/common';
import { GENESIS_HASH, computeRowHash } from './audit-hash';
import { emitAuditMetric } from './audit-metrics-emf';
import { AuditS3MirrorService, type MirroredAuditRow } from './audit-s3-mirror.service';
import {
  AuditWriterService,
  runVerification,
  type AuditChainDiscrepancy,
  type AuditChainVerifiableRow,
  type AuditChainVerificationExtended,
} from './audit-writer.service';

/**
 * Verificador del audit hash chain — Sprint 2 S2-07.
 *
 * Extiende la verificación que vivía sólo en `AuditWriterService.verifyChain`
 * (DB) con una segunda fuente: el mirror inmutable en S3 (Object Lock
 * COMPLIANCE 730d). Permite tres modos:
 *
 *  - `db`   → recomputa el chain leyendo Postgres (comportamiento original).
 *  - `s3`   → recompone el chain con NDJSON descargado del bucket S3 inmutable.
 *  - `both` → cross-check fila a fila (rowId): si alguna fila tiene `rowHash`
 *             diferente entre DB y S3 → tampering detectado en el lado mutable
 *             (Postgres). El lado S3 actúa como ground-truth porque Object
 *             Lock COMPLIANCE impide modificación.
 *
 * Importante: con `source='both'`, una fila que aún no fue mirroreada
 * (mirror corre cada 60s) NO se considera discrepancia — la marcamos como
 * `pending_mirror` (filtrada del cross-check). De lo contrario tendríamos
 * falsos positivos durante la ventana eventual-consistent.
 */
@Injectable()
export class AuditChainVerifierService {
  private readonly log = new Logger(AuditChainVerifierService.name);

  constructor(
    private readonly writer: AuditWriterService,
    private readonly mirror: AuditS3MirrorService,
  ) {}

  async verify(tenantId: string, source: 'db' | 's3' | 'both'): Promise<AuditChainVerificationExtended> {
    const checkedAt = new Date().toISOString();

    if (source === 'db') {
      const dbRes = await this.writer.verifyChain(tenantId);
      // F6 iter 2 — EMF metric `AuditChainValid` (1=ok, 0=tampered). F8 alarma
      // en `Min < 1 over 1h` dispara incident pipe (RB-013 audit tampering).
      emitAuditMetric('AuditChainValid', dbRes.valid ? 1 : 0);
      return { ...dbRes, source: 'db', checkedAt };
    }

    if (source === 's3') {
      const s3Rows = await this.mirror.readAllForTenant(tenantId);
      const s3Res = verifyChainFromMirror(s3Rows);
      emitAuditMetric('AuditChainValid', s3Res.valid ? 1 : 0);
      return { ...s3Res, source: 's3', checkedAt };
    }

    // source === 'both'
    const [dbRes, s3Rows] = await Promise.all([
      this.writer.verifyChainRows(tenantId),
      this.mirror.readAllForTenant(tenantId),
    ]);

    const discrepancies: AuditChainDiscrepancy[] = [];
    const s3ById = new Map<string, MirroredAuditRow>();
    for (const r of s3Rows) s3ById.set(r.id, r);
    const dbById = new Map<string, { id: string; rowHash: string; mirroredToS3: boolean }>();
    for (const r of dbRes.rows) dbById.set(r.id, r);

    // 1) DB rows mirroreadas que faltan o difieren en S3.
    for (const dbRow of dbRes.rows) {
      // Si la fila aún no se mirrored (mirror eventual): no es discrepancia.
      if (!dbRow.mirroredToS3) continue;
      const s3Row = s3ById.get(dbRow.id);
      if (!s3Row) {
        discrepancies.push({ rowId: dbRow.id, reason: 'missing_in_s3', db: { rowHash: dbRow.rowHash } });
        continue;
      }
      if (s3Row.rowHash !== dbRow.rowHash) {
        discrepancies.push({
          rowId: dbRow.id,
          reason: 'row_hash_mismatch',
          db: { rowHash: dbRow.rowHash },
          s3: { rowHash: s3Row.rowHash },
        });
      }
    }
    // 2) S3 rows que faltan en DB (un actor borró la fila Postgres post-mirror).
    for (const s3Row of s3Rows) {
      if (!dbById.has(s3Row.id)) {
        discrepancies.push({ rowId: s3Row.id, reason: 'missing_in_db', s3: { rowHash: s3Row.rowHash } });
      }
    }

    // C-10 — Recompute hash chain COMPLETO en cada lado por separado.
    // Antes el path "both" solo encadenaba `prev_hash` (light path), lo que
    // permitía tampering coordinado: actor con BYPASSRLS UPDATE-aba payloadDiff
    // + rowHash recomputado matching, mientras que prev_hash de la fila
    // siguiente seguía consistente con el rowHash modificado → cadena seguía
    // "íntegra" en el chequeo light. Con `runVerification` se recomputa SHA-256
    // del canonical input y se compara contra rowHash persistido — cualquier
    // tampering al payloadDiff (sin re-firmar TODA la cadena posterior) se
    // detecta. Y si la fila ya fue mirroreada, el cross-check DB↔S3 hace de
    // ground-truth (Object Lock COMPLIANCE bloquea modificación post-mirror).
    const dbVerifiableRows: AuditChainVerifiableRow[] = dbRes.rows.map((r) => ({
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
    }));
    const dbChainResult = runVerification(dbVerifiableRows);
    const s3ChainResult = verifyChainFromMirror(s3Rows);

    // Si la cadena DB se rompió por recompute SHA, registramos discrepancy
    // adicional con `row_hash_mismatch` (auto-discrepancy: el rowHash en BD
    // no matchea el SHA del payload). Esto cubre el caso donde la fila aún
    // NO fue mirroreada (cross-check DB↔S3 no la detecta) pero el SHA
    // recomputed traiciona el tampering.
    if (!dbChainResult.valid && dbChainResult.brokenAtId) {
      const broken = dbVerifiableRows.find((r) => r.id === dbChainResult.brokenAtId);
      if (broken && !discrepancies.some((d) => d.rowId === broken.id)) {
        discrepancies.push({
          rowId: broken.id,
          reason: 'row_hash_mismatch',
          db: { rowHash: broken.rowHash },
        });
      }
    }

    const valid = discrepancies.length === 0 && dbChainResult.valid && s3ChainResult.valid;

    // F6 iter 2 — EMF metrics F8 needs:
    //  - `AuditChainValid` (1/0) — agregado del cross-source check (DB SHA
    //    + S3 SHA + DB↔S3 reconciliation). Si CUALQUIERA detecta tampering
    //    el valor es 0 → alarma F8 dispara RB-013.
    //  - `MirrorLagSeconds` (gauge) — diff entre la fila DB más reciente y
    //    la última fila mirroreada en S3. Latencia esperada ≤ intervalo del
    //    mirror (60s default + buffer). Alarma F8 en `Avg > 300s over 15m`
    //    indica que el cron del mirror está caído.
    emitAuditMetric('AuditChainValid', valid ? 1 : 0);
    const lagSeconds = computeMirrorLagSeconds(dbRes.rows, s3Rows);
    if (lagSeconds !== null) {
      emitAuditMetric('MirrorLagSeconds', lagSeconds);
    }

    return {
      valid,
      totalRows: dbRes.rows.length,
      source: 'both',
      discrepancies: discrepancies.length > 0 ? discrepancies : undefined,
      checkedAt,
    };
  }
}

/**
 * F6 iter 2 — Calcula el lag (segundos) entre la última fila del audit_log
 * en DB y el último timestamp visto en el mirror S3 del mismo tenant.
 *
 *   - Si NO hay filas DB → `null` (no hay nada que medir).
 *   - Si hay filas DB pero S3 está vacío → lag = (now - lastDbOccurredAt).
 *     Indica que el mirror nunca ha corrido para ese tenant.
 *   - Si hay filas en ambos lados → lag = (lastDbOccurredAt - lastS3OccurredAt).
 *     Si DB está adelantado del mirror → lag positivo.
 *
 * El cómputo es best-effort: una fila reciente en DB podría aún no estar
 * mirroreada (mirror tick cada 60s). El alarm threshold de F8 se calibra
 * para tolerar ese intervalo + buffer.
 */
function computeMirrorLagSeconds(
  dbRows: Array<{ occurredAt: Date }>,
  s3Rows: Array<{ occurredAt: string }>,
): number | null {
  if (dbRows.length === 0) return null;
  const lastDb = dbRows.reduce((max, r) => (r.occurredAt.getTime() > max ? r.occurredAt.getTime() : max), 0);
  if (s3Rows.length === 0) {
    // Sin mirror: lag desde la fila DB más reciente hasta ahora.
    return Math.max(0, (Date.now() - lastDb) / 1000);
  }
  const lastS3 = s3Rows.reduce((max, r) => {
    const t = new Date(r.occurredAt).getTime();
    return t > max ? t : max;
  }, 0);
  return Math.max(0, (lastDb - lastS3) / 1000);
}

/**
 * Recompone la cadena hash a partir de filas mirroreadas y verifica
 * encadenamiento + recompute de row_hash. Comparte la lógica con
 * `AuditWriterService.verifyChain` salvo que la fuente de las filas es
 * NDJSON parseado en lugar de Prisma.
 */
export function verifyChainFromMirror(rows: MirroredAuditRow[]): {
  valid: boolean;
  brokenAtId?: string;
  totalRows: number;
} {
  let prevExpected = GENESIS_HASH;
  for (const row of rows) {
    if (row.prevHash !== prevExpected) {
      return { valid: false, brokenAtId: row.id, totalRows: rows.length };
    }
    const recomputed = computeRowHash({
      prevHash: row.prevHash,
      tenantId: row.tenantId,
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      payloadDiff: row.payloadDiff ?? null,
      occurredAt: new Date(row.occurredAt),
    });
    if (recomputed !== row.rowHash) {
      return { valid: false, brokenAtId: row.id, totalRows: rows.length };
    }
    prevExpected = row.rowHash;
  }
  return { valid: true, totalRows: rows.length };
}

// C-10 — `recomputeChainOkFromDb` (light path, solo prev_hash) eliminada:
// permitía tampering coordinado (UPDATE de payloadDiff + rowHash matching)
// pasar silencioso. Ahora `verify(source='both')` usa `runVerification`
// importada desde audit-writer (full SHA recompute). Ver fix B-AUDIT C-10.
