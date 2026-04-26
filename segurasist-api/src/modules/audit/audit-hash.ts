import { createHash } from 'node:crypto';

/**
 * Hash chain helpers para `audit_log`. Mantenidos en módulo separado para
 * que el endpoint `verify-chain` reuse exactamente la misma serialización
 * canónica que el writer (cualquier divergencia → toda la cadena queda
 * marcada como tampered).
 */

/** Génesis del chain: 64 ceros hex. Primera fila por tenant. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * Serialización JSON canónica. Distinta a `JSON.stringify(value)`:
 *
 *  - Las claves de cada objeto se ordenan lexicográficamente, recursivamente.
 *    Garantiza que `{a:1,b:2}` y `{b:2,a:1}` produzcan el mismo string.
 *  - `undefined` → omitido (matchea behavior de JSON.stringify).
 *  - Arrays: orden preservado (semánticamente significativo).
 *  - `null` se serializa como `null`.
 *  - No usamos `JSON.stringify` con replacer para evitar floating-point /
 *    edge cases con Date — el writer ya pasa primitivos plain.
 *
 * Output determinístico → mismo input, mismo hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
    }
    return '{' + parts.join(',') + '}';
  }
  // Fallback (BigInt, Symbol, etc): nunca debería llegar aquí desde el writer.
  return JSON.stringify(String(value));
}

/**
 * Inputs canónicos del row_hash. Mantenidos como tipo explícito para que
 * cualquier cambio futuro (e.g. añadir traceId al hash) sea un cambio
 * versionado y testeable.
 */
export interface AuditChainInputs {
  prevHash: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  payloadDiff: unknown;
  occurredAt: Date;
}

/**
 * Concatenación canónica de los campos del audit chain. Separador `|` para
 * que campos vacíos (e.g. actorId=null → "null") no colisionen con valores
 * que contengan el separador como substring (e.g. resourceType="users|x").
 */
export function buildCanonical(inputs: AuditChainInputs): string {
  return [
    inputs.prevHash,
    inputs.tenantId,
    inputs.actorId === null ? 'null' : inputs.actorId,
    inputs.action,
    inputs.resourceType,
    inputs.resourceId === null ? 'null' : inputs.resourceId,
    canonicalJson(inputs.payloadDiff),
    inputs.occurredAt.toISOString(),
  ].join('|');
}

/** Compute SHA-256 hex digest del canonical string. */
export function computeRowHash(inputs: AuditChainInputs): string {
  return createHash('sha256').update(buildCanonical(inputs)).digest('hex');
}
