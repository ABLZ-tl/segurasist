/**
 * Validación del dígito verificador SEGOB de una CURP mexicana.
 *
 * Algoritmo público (Norma Oficial Mexicana — Diario Oficial de la Federación,
 * 18-oct-1999, "Lineamientos generales para la asignación, certificación y
 * uso de la Clave Única de Registro de Población"):
 *
 *  1) Cada uno de los primeros 17 caracteres se convierte a un valor numérico
 *     según una tabla fija (`CURP_CHARSET`). El índice del char en la tabla
 *     ES su valor:
 *       '0'..'9'  →  0..9
 *       'A'       → 10
 *       'B'       → 11
 *       ...
 *       'Z'       → 35
 *       'Ñ'       → 17 (NOTA: `Ñ` ocupa una posición específica entre 'N' y 'O')
 *
 *  2) Cada valor se multiplica por un peso descendente: 18, 17, 16, ..., 2.
 *     (Los pesos van de la posición 0 → 18, posición 1 → 17, ..., posición 16 → 2).
 *
 *  3) Se suman todos los productos.
 *
 *  4) `dv = (10 - (suma % 10)) % 10`.
 *
 *  5) El dígito en posición 17 (último char de la CURP) debe ser igual a `dv`.
 *
 * Notas de implementación:
 *  - La función NO valida formato regex (lo hace Zod arriba); asume input
 *    UPPERCASED. Si encuentra un char fuera del charset devuelve `false`.
 *  - Es pura, sin side effects, O(17). Safe para batchear 10k filas.
 *  - Hay CURPs históricas pre-1999 con dígito verificador "incorrecto" según
 *    este algoritmo. SegurAsist DEMO sólo acepta CURPs post-1999; queda
 *    documentado y discutido con MAC-002.
 */

// La tabla oficial SEGOB. Importante: 'Ñ' va en la posición 24, entre 'N' (23) y 'O' (24)
// según el documento original. Las implementaciones varían en este detalle —
// la nuestra coincide con el catálogo RENAPO publicado por la Secretaría de
// Gobernación.
const CURP_CHARSET = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';

/**
 * Devuelve `true` si el dígito verificador de la CURP es válido.
 * Asume que la cadena ya pasó el regex `^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$`.
 */
export function isCurpChecksumValid(curp: string): boolean {
  if (typeof curp !== 'string' || curp.length !== 18) return false;

  const upper = curp.toUpperCase();
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const ch = upper[i];
    if (ch === undefined) return false;
    const value = CURP_CHARSET.indexOf(ch);
    if (value === -1) return false;
    const weight = 18 - i;
    sum += value * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  const actualChar = upper[17];
  if (actualChar === undefined) return false;
  const actualDigit = Number(actualChar);
  if (!Number.isInteger(actualDigit)) return false;
  return expected === actualDigit;
}

/**
 * Calcula el dígito verificador para los primeros 17 chars de una CURP.
 * Útil para generar fixtures de test deterministas.
 *
 * @param prefix17 Los primeros 17 caracteres (sin el dígito verificador).
 * @returns El dígito verificador (0..9). Lanza Error si el prefix tiene
 *          longitud ≠17 o un char fuera de `CURP_CHARSET`.
 */
export function computeCurpChecksum(prefix17: string): number {
  if (prefix17.length !== 17) {
    throw new Error(`computeCurpChecksum: prefix debe tener 17 chars, recibido ${prefix17.length}`);
  }
  const upper = prefix17.toUpperCase();
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const ch = upper[i];
    if (ch === undefined) {
      throw new Error(`computeCurpChecksum: index ${i} undefined`);
    }
    const value = CURP_CHARSET.indexOf(ch);
    if (value === -1) {
      throw new Error(`computeCurpChecksum: char inválido '${ch}' en posición ${i}`);
    }
    sum += value * (18 - i);
  }
  return (10 - (sum % 10)) % 10;
}
