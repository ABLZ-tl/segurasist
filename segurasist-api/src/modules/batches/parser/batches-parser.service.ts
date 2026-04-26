import { Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { decodeCsvToText, InvalidCsvEncodingError, parseCsvText } from './csv-parser';
import {
  CANONICAL_COLUMN_KEYS,
  type CanonicalColumnKey,
  type ParsedRow,
  ParserError,
  normalizeHeader,
} from './types';

/**
 * Parser de archivos de carga masiva. Convierte XLSX/CSV → `ParsedRow[]`
 * (string-only) que el `BatchesValidatorService` consumirá.
 *
 * Reglas comunes a ambos formatos:
 *  - Header obligatorio. Sin header reconocido → `NO_HEADER`.
 *  - Filas vacías intermedias se ignoran (no entran en el `ParsedRow[]`)
 *    y se loggean con un warning a nivel agregado en el service.
 *  - Encoding Latin-1 / Windows-1252: rechazado con `INVALID_ENCODING`.
 *  - Max rows: la cota 10k se valida fuera del parser (BatchesService),
 *    para que el error retornado sea `BATCH_TOO_LARGE` (413) con instance del
 *    upload en lugar de un parser internal error.
 */
@Injectable()
export class BatchesParserService {
  private readonly log = new Logger(BatchesParserService.name);

  /**
   * Parsea un buffer XLSX usando exceljs. Toma la hoja `asegurados` (case-insensitive)
   * o, si no existe, la primera hoja del workbook.
   */
  async parseXlsx(buffer: Buffer): Promise<ParsedRow[]> {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new ParserError('Archivo XLSX vacío', 'EMPTY_FILE');
    }

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'fallo al leer XLSX';
      throw new ParserError(`XLSX corrupto o no soportado: ${msg}`, 'UNSUPPORTED_FILE');
    }

    if (wb.worksheets.length === 0) {
      throw new ParserError('XLSX sin hojas', 'NO_SHEET');
    }

    // Buscar la hoja `asegurados` (case-insensitive). Fallback: primera hoja.
    const target =
      wb.worksheets.find((w) => w.name.trim().toLowerCase() === 'asegurados') ?? wb.worksheets[0]!;

    return this.extractRowsFromExceljs(target);
  }

  /**
   * Parsea un buffer CSV (UTF-8 obligatorio, separador `,`).
   */
  parseCsv(buffer: Buffer): ParsedRow[] {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new ParserError('Archivo CSV vacío', 'EMPTY_FILE');
    }

    let text: string;
    try {
      text = decodeCsvToText(buffer);
    } catch (err) {
      if (err instanceof InvalidCsvEncodingError) {
        throw new ParserError(err.message, 'INVALID_ENCODING');
      }
      throw err;
    }

    if (text.trim().length === 0) {
      throw new ParserError('Archivo CSV vacío', 'EMPTY_FILE');
    }

    const rows = parseCsvText(text);
    if (rows.length === 0) {
      throw new ParserError('Archivo CSV sin filas', 'EMPTY_FILE');
    }
    return this.normalizeRows(rows);
  }

  // ---------------------------------------------------------------------
  // helpers internos
  // ---------------------------------------------------------------------

  private extractRowsFromExceljs(ws: ExcelJS.Worksheet): ParsedRow[] {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      // exceljs row.values: index 0 es undefined; 1..N son las celdas.
      const values = row.values as unknown[];
      const max = Math.max(values.length, ws.columnCount + 1);
      for (let i = 1; i < max; i += 1) {
        cells.push(this.cellToString(values[i]));
      }
      rows.push(cells);
    });
    return this.normalizeRows(rows);
  }

  private cellToString(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v instanceof Date) {
      // Convertimos a ISO date (YYYY-MM-DD) para que el validator no tenga que
      // adivinar formato. Excel devuelve Date para celdas con format date.
      const yyyy = v.getUTCFullYear().toString().padStart(4, '0');
      const mm = (v.getUTCMonth() + 1).toString().padStart(2, '0');
      const dd = v.getUTCDate().toString().padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    if (typeof v === 'object') {
      // Hyperlink, RichText, formula → fallback a `text` o `result`.
      const o = v as Record<string, unknown>;
      if (typeof o.text === 'string') return o.text.trim();
      if (typeof o.result === 'string') return o.result.trim();
      if (typeof o.result === 'number') return String(o.result);
      if (Array.isArray(o.richText)) {
        return (o.richText as Array<{ text?: string }>)
          .map((p) => p.text ?? '')
          .join('')
          .trim();
      }
    }
    return String(v).trim();
  }

  /**
   * Convierte la matriz `string[][]` (header + data) en `ParsedRow[]`.
   * Hace el mapeo de headers a las keys canónicas y descarta filas vacías.
   */
  private normalizeRows(allRows: string[][]): ParsedRow[] {
    if (allRows.length === 0) {
      throw new ParserError('Archivo sin contenido', 'EMPTY_FILE');
    }
    const headerRow = allRows[0]!;
    const columnMap = new Map<number, CanonicalColumnKey>();
    for (let i = 0; i < headerRow.length; i += 1) {
      const raw = headerRow[i];
      if (typeof raw !== 'string' || raw.trim().length === 0) continue;
      const canonical = normalizeHeader(raw);
      if (canonical !== null) {
        columnMap.set(i, canonical);
      }
    }
    if (columnMap.size === 0) {
      throw new ParserError(
        `No se reconoció ningún header. Esperado al menos uno de: ${CANONICAL_COLUMN_KEYS.join(', ')}`,
        'NO_HEADER',
      );
    }

    const out: ParsedRow[] = [];
    let emptySkipped = 0;
    for (let r = 1; r < allRows.length; r += 1) {
      const cells = allRows[r]!;
      // Fila vacía si TODAS las celdas son strings vacíos.
      const isEmpty = cells.every((c) => (typeof c === 'string' ? c.trim() === '' : c === undefined));
      if (isEmpty) {
        emptySkipped += 1;
        continue;
      }
      const raw: Record<string, string> = {};
      for (const [colIdx, key] of columnMap.entries()) {
        const value = cells[colIdx];
        raw[key] = typeof value === 'string' ? value.trim() : value !== undefined ? String(value).trim() : '';
      }
      out.push({ rowNumber: r + 1, raw });
    }
    if (emptySkipped > 0) {
      this.log.warn(`Parser: ${emptySkipped} filas vacías intermedias ignoradas`);
    }
    return out;
  }
}
