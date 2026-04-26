/**
 * L4 — magic bytes detection.
 *
 * Generamos los fixtures dinámicamente:
 *  - XLSX real con `exceljs` (mismo flow que `LayoutsService`).
 *  - CSV real (texto plano + BOM opcional).
 *  - "EXE" simulado con `4D 5A` (cabecera DOS) seguido de basura binaria.
 *  - ZIP arbitrario sin `xl/workbook.xml` (para validar que rechazamos JARs
 *    o ZIPs de otra naturaleza).
 *
 * No usamos `node:fs` ni `crypto` para los CSV/EXE — Buffer literal es más
 * determinístico y evita ruido de I/O en test.
 */
import ExcelJS from 'exceljs';
import { detectFileType } from '../../../src/common/utils/file-magic-bytes';

async function buildRealXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['col1', 'col2']);
  ws.addRow(['a', 'b']);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

function buildCsvBuffer(opts: { withBom?: boolean } = {}): Buffer {
  const csv = 'curp,nombre\nPEPM800101HDFRRR01,Maria\nABCD000000HDFRRR02,Pedro\n';
  if (opts.withBom) {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf8')]);
  }
  return Buffer.from(csv, 'utf8');
}

function buildExeBuffer(): Buffer {
  // Cabecera DOS `MZ` (4D 5A) + basura binaria.
  const bytes: number[] = [0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00];
  for (let i = 0; i < 100; i += 1) bytes.push(i % 256);
  return Buffer.from(bytes);
}

function buildArbitraryZipBuffer(): Buffer {
  // ZIP signature + entrada genérica (NO contiene `xl/workbook.xml`).
  // Estructura mínima: PK\x03\x04 + filename "evil.txt" + payload basura.
  const head = Buffer.from([
    0x50,
    0x4b,
    0x03,
    0x04, // local file header signature
    0x14,
    0x00, // version
    0x00,
    0x00, // flags
    0x00,
    0x00, // compression (stored)
    0x00,
    0x00, // mod time
    0x00,
    0x00, // mod date
    0x00,
    0x00,
    0x00,
    0x00, // crc32
    0x05,
    0x00,
    0x00,
    0x00, // compressed size
    0x05,
    0x00,
    0x00,
    0x00, // uncompressed size
    0x08,
    0x00, // filename length = 8
    0x00,
    0x00, // extra field length
  ]);
  const filename = Buffer.from('evil.txt', 'utf8');
  const payload = Buffer.from('hello', 'utf8');
  return Buffer.concat([head, filename, payload]);
}

describe('detectFileType (L4)', () => {
  it('XLSX real (generado con exceljs) → "xlsx"', async () => {
    const buf = await buildRealXlsxBuffer();
    expect(detectFileType(buf)).toBe('xlsx');
  });

  it('CSV simple → "csv"', () => {
    const buf = buildCsvBuffer();
    expect(detectFileType(buf)).toBe('csv');
  });

  it('CSV con BOM UTF-8 → "csv"', () => {
    const buf = buildCsvBuffer({ withBom: true });
    expect(detectFileType(buf)).toBe('csv');
  });

  it('EXE (cabecera MZ 4D 5A) → "unknown"', () => {
    const buf = buildExeBuffer();
    expect(detectFileType(buf)).toBe('unknown');
  });

  it('ZIP arbitrario sin xl/workbook.xml → "unknown" (rechazado)', () => {
    const buf = buildArbitraryZipBuffer();
    expect(detectFileType(buf)).toBe('unknown');
  });

  it('Buffer vacío → "unknown"', () => {
    expect(detectFileType(Buffer.alloc(0))).toBe('unknown');
  });

  it('Sólo BOM UTF-8 sin contenido → "unknown"', () => {
    expect(detectFileType(Buffer.from([0xef, 0xbb, 0xbf]))).toBe('unknown');
  });

  it('Texto con NUL/ETX (binario disfrazado de texto) → "unknown"', () => {
    // NUL (0x00) y 0x01 son control bytes prohibidos en CSV: heurística los
    // detecta como binario y rechaza.
    const buf = Buffer.from([0x68, 0x69, 0x00, 0x01, 0x68]);
    expect(detectFileType(buf)).toBe('unknown');
  });

  it('Texto ASCII plano sin NUL pasa como CSV (heurística MVP)', () => {
    // Si llega un JSON/YAML legítimo, la siguiente capa (parser CSV de
    // BatchesService) devolverá VALIDATION_ERROR — magic-bytes sólo filtra
    // binarios sospechosos en este nivel.
    const buf = Buffer.from('hello world', 'utf8');
    expect(detectFileType(buf)).toBe('csv');
  });

  it('Argumento que no es Buffer → "unknown"', () => {
    expect(detectFileType('not a buffer' as unknown as Buffer)).toBe('unknown');
  });
});
