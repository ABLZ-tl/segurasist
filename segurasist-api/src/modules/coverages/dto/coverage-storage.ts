/**
 * S2-02 — Coverage storage adapter.
 *
 * El schema Prisma actual (`Coverage.type` = enum coverage_type
 * {consultation,emergency,hospitalization,...}) refleja taxonomía CLÍNICA.
 * El producto S2-02 expone una taxonomía OPERACIONAL más simple:
 *   - count   → cobertura limitada por # de eventos
 *   - amount  → cobertura limitada por $ MXN
 *
 * Para no agregar otro campo al schema (que es owned por otro agente vía
 * migraciones de S1), persistimos el shape user-facing dentro de
 * `Coverage.description` como JSON-envelope:
 *
 *   { "kind": "count" | "amount",
 *     "unit": "consultas" | "MXN" | ...,
 *     "description": "<freeform>" | null }
 *
 * Y mapeamos el enum DB con dos buckets fijos:
 *   - count  ⇒ "consultation"  (genérico contador)
 *   - amount ⇒ "pharmacy"      (genérico monto)
 *
 * Cuando MAC-XXX agregue una columna `coverage_kind` dedicada, este adapter
 * desaparece y leemos/escribimos de la columna directa.
 */

import type { CoverageType } from '@prisma/client';

export interface CoverageEnvelope {
  kind: 'count' | 'amount';
  unit: string;
  description: string | null;
}

const COUNT_DB_TYPE: CoverageType = 'consultation';
const AMOUNT_DB_TYPE: CoverageType = 'pharmacy';

export function toDbType(kind: 'count' | 'amount'): CoverageType {
  return kind === 'count' ? COUNT_DB_TYPE : AMOUNT_DB_TYPE;
}

export function encodeDescription(envelope: CoverageEnvelope): string {
  return JSON.stringify(envelope);
}

export function decodeDescription(raw: string | null, dbType: string): CoverageEnvelope {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<CoverageEnvelope>;
      if (parsed && (parsed.kind === 'count' || parsed.kind === 'amount')) {
        return {
          kind: parsed.kind,
          unit: typeof parsed.unit === 'string' ? parsed.unit : 'unit',
          description: typeof parsed.description === 'string' ? parsed.description : null,
        };
      }
    } catch {
      // Fall through to legacy mapping (plain text description).
    }
  }
  // Legacy: plain text description, no envelope. Map by dbType heuristic.
  const kind: 'count' | 'amount' = dbType === AMOUNT_DB_TYPE ? 'amount' : 'count';
  return { kind, unit: kind === 'amount' ? 'MXN' : 'unit', description: raw };
}
