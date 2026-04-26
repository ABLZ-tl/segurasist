/**
 * Tipos compartidos del validator de batches.
 *
 * `RowResult` es un union discriminado: el caller decide qué hacer (insertar
 * en `insureds` o persistir en `batch_errors`) checando `result.valid`.
 */
import type { CreateInsuredDto } from '@modules/insureds/dto/insured.dto';
import type { CanonicalColumnKey } from '../parser/types';

/**
 * Catálogo central de códigos de error. Mantener en sync con
 * `docs/errors/` (cuando se cree el spec) y con la UI del Admin.
 */
export const ROW_ERROR_CODES = [
  'CURP_INVALID',
  'CURP_CHECKSUM_INVALID',
  'CURP_REQUIRED',
  'RFC_INVALID',
  'NAME_INVALID',
  'NAME_REQUIRED',
  'DOB_INVALID',
  'DOB_OUT_OF_RANGE',
  'EMAIL_INVALID',
  'PHONE_INVALID',
  'PACKAGE_REQUIRED',
  'PACKAGE_NOT_FOUND',
  'VALIDITY_INVALID',
  'VALIDITY_END_BEFORE_START',
  'BENEFICIARIES_TOO_MANY',
  'BENEFICIARIES_MALFORMED',
  'DUPLICATED_IN_FILE',
  'DUPLICATED_IN_TENANT',
  'INSURED_OVERLAPPING_VALIDITY',
  'PARSE_ERROR',
  'UNKNOWN_ERROR',
] as const;
export type RowErrorCode = (typeof ROW_ERROR_CODES)[number];

export interface FieldError {
  /** Campo canónico al que pertenece el error (o `null` si es global a la fila). */
  column: CanonicalColumnKey | null;
  code: RowErrorCode;
  /** Mensaje legible en español. */
  message: string;
  /** El valor crudo que falló — útil para mostrarlo en el preview. */
  rawValue?: string;
  /** Para PACKAGE_NOT_FOUND: top-3 sugerencias por Levenshtein. */
  suggestions?: string[];
}

export type RowResult =
  | { valid: true; rowNumber: number; dto: CreateInsuredDto }
  | { valid: false; rowNumber: number; errors: FieldError[]; rawCurp: string | null };

/**
 * Contexto del tenant para validar contra catálogos (paquetes, CURPs ya activos).
 *
 * Se construye una vez por batch y se pasa al validator para evitar N queries.
 */
export interface ValidationContext {
  tenantId: string;
  /** Catálogo de paquetes activos del tenant (id + name). */
  packages: ReadonlyArray<{ id: string; name: string }>;
  /**
   * Set de CURPs ya activos en el tenant (uppercased). El validator los
   * marcará con `DUPLICATED_IN_TENANT`. Para detectar `INSURED_OVERLAPPING_VALIDITY`
   * usar `activeInsuredsByCurp` (más detallado).
   */
  existingActiveCurps: ReadonlySet<string>;
  /**
   * Map curp → vigencia_fin del insured activo. Si la nueva fila tiene
   * `vigencia_inicio < existing.validTo`, marcamos `INSURED_OVERLAPPING_VALIDITY`.
   */
  activeInsuredsByCurp: ReadonlyMap<string, { validTo: Date; insuredId: string }>;
}
