/**
 * Modelo de fila parseada desde XLSX/CSV. Es el shape que recibe el validator.
 *
 * `rowNumber` está en base 1 con la convención humana de Excel:
 *   - row 1 = header
 *   - row 2..N = filas de datos
 *
 * El parser NO normaliza tipos (todo viene como string trimmed); la
 * conversión y validación las hace `BatchesValidatorService`.
 */
export interface ParsedRow {
  rowNumber: number;
  raw: Record<string, string>;
}

/**
 * Headers oficiales del layout v1 (MAC-002 — `external/MAC-002-layout-asegurados.md`).
 *
 * El parser hace match case-insensitive y con trim. La canónica
 * (`CANONICAL_COLUMN_KEYS`) es la que termina en `ParsedRow.raw[<key>]`.
 */
export const CANONICAL_COLUMN_KEYS = [
  'curp',
  'rfc',
  'nombre_completo',
  'fecha_nacimiento',
  'email',
  'telefono',
  'paquete',
  'vigencia_inicio',
  'vigencia_fin',
  'entidad',
  'numero_empleado_externo',
  'beneficiarios',
] as const;

export type CanonicalColumnKey = (typeof CANONICAL_COLUMN_KEYS)[number];

/**
 * Aliases tolerados por el parser. Mapean variantes (con espacios, acentos
 * o el header del template viejo demo v0) a la columna canónica.
 *
 * Reglas de matching (en orden):
 *   1) Trim + lower + reemplazo de espacios → guion bajo + remove acentos.
 *   2) Lookup en este alias map.
 *   3) Lookup directo en `CANONICAL_COLUMN_KEYS`.
 */
export const COLUMN_ALIASES: Record<string, CanonicalColumnKey> = {
  curp: 'curp',
  rfc: 'rfc',
  nombre_completo: 'nombre_completo',
  nombre: 'nombre_completo',
  fecha_nacimiento: 'fecha_nacimiento',
  fecha_de_nacimiento: 'fecha_nacimiento',
  fecha_nac: 'fecha_nacimiento',
  email: 'email',
  correo: 'email',
  correo_electronico: 'email',
  telefono: 'telefono',
  tel: 'telefono',
  movil: 'telefono',
  paquete: 'paquete',
  vigencia_inicio: 'vigencia_inicio',
  inicio_vigencia: 'vigencia_inicio',
  vigencia_fin: 'vigencia_fin',
  fin_vigencia: 'vigencia_fin',
  entidad: 'entidad',
  numero_empleado_externo: 'numero_empleado_externo',
  num_empleado: 'numero_empleado_externo',
  numero_empleado: 'numero_empleado_externo',
  beneficiarios: 'beneficiarios',
};

export class ParserError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'UNSUPPORTED_FILE'
      | 'INVALID_ENCODING'
      | 'EMPTY_FILE'
      | 'NO_HEADER'
      | 'NO_SHEET'
      | 'TOO_MANY_ROWS',
  ) {
    super(message);
    this.name = 'ParserError';
  }
}

/**
 * Normaliza un header header crudo (puede venir con acentos, espacios, mixed
 * case) a su key canónica. Devuelve `null` si no se reconoce.
 */
export function normalizeHeader(raw: string): CanonicalColumnKey | null {
  if (typeof raw !== 'string') return null;
  // Remueve diacríticos (NFD + filter combining marks).
  const stripped = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_');

  if (stripped in COLUMN_ALIASES) return COLUMN_ALIASES[stripped]!;
  return null;
}
