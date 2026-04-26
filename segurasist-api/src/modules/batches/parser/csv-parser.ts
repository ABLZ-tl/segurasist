/**
 * Mini parser RFC 4180 para CSV.
 *
 * Por qué propio en lugar de `papaparse`:
 *   - El alcance es muy reducido (parseo en memoria de archivos ≤25 MB).
 *   - Evita una dep extra que duplicaría comportamiento de `exceljs` para XLSX.
 *   - Tenemos control total sobre detección de encoding (rechazo Latin-1),
 *     normalización de headers y manejo de filas vacías intermedias.
 *
 * Soporta:
 *  - Separador `,` (default).
 *  - Quoting con `"`. Comillas escapadas como `""` dentro de un campo quoted.
 *  - Line endings `\n` y `\r\n`.
 *  - BOM UTF-8 al inicio (lo descarta).
 *  - Filas con cantidades distintas de columnas (rellena con strings vacíos).
 *
 * NO soporta:
 *  - Separadores `;` ni TAB (MAC-002 fija `,` como separador del layout).
 *  - Multi-line headers / comments.
 *
 * Detección de encoding: si el buffer NO es UTF-8 válido (incluye un byte
 * en rango 0x80-0xFF que no forma parte de una secuencia UTF-8 válida),
 * lanza `INVALID_ENCODING` para que el caller responda con error claro al
 * usuario. Latin-1 con acentos es la falla más común — por eso es la regla.
 */

const UTF8_BOM_BYTE0 = 0xef;
const UTF8_BOM_BYTE1 = 0xbb;
const UTF8_BOM_BYTE2 = 0xbf;

export class InvalidCsvEncodingError extends Error {
  constructor(message = 'CSV no es UTF-8 válido (¿Latin-1?). Re-exportar con encoding UTF-8.') {
    super(message);
    this.name = 'InvalidCsvEncodingError';
  }
}

/**
 * Verifica que `buffer` sea UTF-8 válido (puro). Devuelve `true` si lo es,
 * `false` en caso contrario. No requiere decodificar — sólo recorre los
 * bytes con la máquina de estados de UTF-8.
 *
 * Heurística: rechaza explícitamente bytes 0x80-0xBF al inicio de una
 * secuencia (esos son continuation bytes y no pueden ser leading), 0xC0-0xC1
 * (overlong) y 0xF5-0xFF (fuera del rango unicode).
 */
export function isValidUtf8(buffer: Buffer): boolean {
  let i = 0;
  while (i < buffer.length) {
    const b = buffer[i]!;
    if (b < 0x80) {
      i += 1;
      continue;
    }
    let extra = 0;
    if (b >= 0xc2 && b <= 0xdf) extra = 1;
    else if (b >= 0xe0 && b <= 0xef) extra = 2;
    else if (b >= 0xf0 && b <= 0xf4) extra = 3;
    else return false; // 0x80-0xc1 (continuation/overlong) o 0xf5+ (fuera Unicode)

    if (i + extra >= buffer.length) return false;
    for (let j = 1; j <= extra; j += 1) {
      const c = buffer[i + j]!;
      if (c < 0x80 || c > 0xbf) return false;
    }
    i += extra + 1;
  }
  return true;
}

/**
 * Convierte el buffer en texto UTF-8 después de validar encoding y descartar BOM.
 *
 * @throws InvalidCsvEncodingError si el contenido no es UTF-8 válido.
 */
export function decodeCsvToText(buffer: Buffer): string {
  if (buffer.length === 0) return '';

  let start = 0;
  if (
    buffer.length >= 3 &&
    buffer[0] === UTF8_BOM_BYTE0 &&
    buffer[1] === UTF8_BOM_BYTE1 &&
    buffer[2] === UTF8_BOM_BYTE2
  ) {
    start = 3;
  }
  const slice = start === 0 ? buffer : buffer.subarray(start);
  if (!isValidUtf8(slice)) {
    throw new InvalidCsvEncodingError();
  }
  return slice.toString('utf8');
}

/**
 * Parser RFC 4180 (subset). Devuelve filas como `string[][]` (incluyendo
 * el header). El caller decide cómo mapear al objeto final.
 */
export function parseCsvText(text: string, separator = ','): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        // ¿Escape `""`?
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === separator) {
      pushField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      // Tratamos `\r\n` como un solo separador.
      pushField();
      pushRow();
      if (text[i + 1] === '\n') i += 2;
      else i += 1;
      continue;
    }
    if (c === '\n') {
      pushField();
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Último campo / fila si el archivo no termina en newline.
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows;
}
