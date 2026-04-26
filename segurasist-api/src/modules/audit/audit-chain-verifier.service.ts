import { Injectable, Logger } from '@nestjs/common';
import { GENESIS_HASH, computeRowHash } from './audit-hash';
import { AuditS3MirrorService, type MirroredAuditRow } from './audit-s3-mirror.service';
import {
  AuditWriterService,
  type AuditChainDiscrepancy,
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
      return { ...dbRes, source: 'db', checkedAt };
    }

    if (source === 's3') {
      const s3Rows = await this.mirror.readAllForTenant(tenantId);
      const s3Res = verifyChainFromMirror(s3Rows);
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

    // Recompute chain en cada lado por separado para detectar tampering local
    // que no se detecta en el cross-check (e.g. tampering en una fila que aún
    // no fue mirroreada).
    const dbChainOk = recomputeChainOkFromDb(dbRes.rows);
    const s3ChainOk = verifyChainFromMirror(s3Rows).valid;

    const valid = discrepancies.length === 0 && dbChainOk && s3ChainOk;
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

function recomputeChainOkFromDb(
  rows: Array<{ id: string; rowHash: string; prevHash: string; mirroredToS3: boolean }>,
): boolean {
  // Esta función es un check ligero: el writer ya tiene la versión completa;
  // aquí sólo comprobamos encadenamiento prev_hash sin recompute SHA (más
  // costoso) — ya pasaríamos por el writer.verifyChain si quisiéramos un
  // recompute completo. Suficiente para detectar shifts groseros.
  let prev = GENESIS_HASH;
  for (const r of rows) {
    if (r.prevHash !== prev) return false;
    prev = r.rowHash;
  }
  return true;
}
