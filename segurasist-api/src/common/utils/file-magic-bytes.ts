/**
 * Detección heurística del tipo real de archivo subido vía multipart.
 *
 * Por qué: el cliente puede mentir en `Content-Type` y `filename`. Un
 * atacante puede subir un EXE renombrado a `.xlsx` y, sin esta validación,
 * el archivo aterriza en S3 — servirlo a un humano más tarde abriría una
 * ventana de XSS / drive-by download. Validamos los primeros bytes para
 * confirmar que el contenido coincide con lo que el endpoint declara
 * aceptar.
 *
 * Soportamos sólo los formatos que `BatchesService.upload` necesita:
 *   - `xlsx` (ZIP container con `xl/workbook.xml` adentro).
 *   - `csv` (texto plano UTF-8 / ASCII printable, opcional BOM).
 *
 * Cualquier otro contenido devuelve `'unknown'`. El controller debe
 * responder 415 (`UNSUPPORTED_FILE`).
 *
 * NOTA: el algoritmo NO usa la librería `file-type` para evitar agregar una
 * dep ESM (que rompe build CommonJS de NestJS). Hacemos la detección a mano:
 *  - XLSX = ZIP signature `50 4B 03 04` + búsqueda del literal
 *    `xl/workbook.xml` dentro de los primeros 64 KB del buffer.
 *  - CSV  = todos los bytes son ASCII printable o whitespace estándar
 *    (LF/CR/TAB), opcionalmente precedidos del UTF-8 BOM (EF BB BF).
 */

export type DetectedFileType = 'xlsx' | 'csv' | 'png' | 'webp' | 'svg' | 'unknown';

const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EMPTY_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]); // ZIP vacío
const ZIP_SPANNED_SIGNATURE = Buffer.from([0x50, 0x4b, 0x07, 0x08]);
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const XLSX_INNER_MARKER = Buffer.from('xl/workbook.xml', 'utf8');

// Sprint 5 — MT-1 branding upload. Imágenes de logo/bg.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// WebP = "RIFF" .... "WEBP" (bytes 0..3 = "RIFF", bytes 8..11 = "WEBP").
const RIFF_SIGNATURE = Buffer.from('RIFF', 'ascii');
const WEBP_MARKER = Buffer.from('WEBP', 'ascii');

/**
 * Devuelve `'xlsx'`, `'csv'` o `'unknown'` analizando los primeros bytes
 * del buffer. No modifica `buffer`.
 *
 * Para `xlsx`:
 *   1) Confirma firma ZIP (4 bytes).
 *   2) Busca el marcador `xl/workbook.xml` en los primeros 64 KB (cualquier
 *      ZIP genérico sin esa entrada se rechaza).
 *
 * Para `csv`:
 *   1) Si empieza con BOM UTF-8, salta 3 bytes.
 *   2) Recorre los siguientes 8 KB; cada byte debe ser printable
 *      (0x20–0x7E), TAB (0x09), LF (0x0A), CR (0x0D) o byte UTF-8 multibyte
 *      (0x80+ — aceptamos para no rechazar nombres con acentos en CSV
 *      latino-1 mal codificado; el parser de CSV detectará luego encoding).
 */
export function detectFileType(buffer: Buffer): DetectedFileType {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return 'unknown';

  // Sprint 5 — MT-1 branding logos. Detección PNG / WebP / SVG ANTES de ZIP
  // porque PNG/WEBP tienen su propia firma; SVG es texto-XML y caería en la
  // rama CSV abajo si no lo identificamos primero (un archivo SVG válido
  // pasa el check de "ASCII printable" y devolvería 'csv', mintiendo al
  // controller de upload).
  if (buffer.length >= 8 && buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).equals(RIFF_SIGNATURE) &&
    buffer.slice(8, 12).equals(WEBP_MARKER)
  ) {
    return 'webp';
  }
  if (isLikelySvg(buffer)) {
    return 'svg';
  }

  // 1) ZIP signature → posible XLSX.
  const isZip =
    buffer.slice(0, 4).equals(ZIP_SIGNATURE) ||
    buffer.slice(0, 4).equals(ZIP_EMPTY_SIGNATURE) ||
    buffer.slice(0, 4).equals(ZIP_SPANNED_SIGNATURE);
  if (isZip) {
    // Búsqueda del marcador del manifiesto XLSX en los primeros 64 KB. Si
    // no aparece, es un ZIP genérico (o JAR, APK, etc.) — rechazamos.
    const window = buffer.slice(0, Math.min(buffer.length, 64 * 1024));
    if (window.indexOf(XLSX_INNER_MARKER) !== -1) {
      return 'xlsx';
    }
    return 'unknown';
  }

  // 2) BOM UTF-8 explícito → asumimos texto / CSV.
  let start = 0;
  if (buffer.length >= 3 && buffer.slice(0, 3).equals(UTF8_BOM)) {
    start = 3;
  }

  // 3) Heurística CSV: ventana inicial sin bytes binarios (NUL, ESC, BEL, etc.).
  const sampleEnd = Math.min(buffer.length, start + 8 * 1024);
  if (sampleEnd === start) {
    // Sólo BOM, sin contenido — no podemos afirmar nada.
    return 'unknown';
  }
  for (let i = start; i < sampleEnd; i += 1) {
    const b = buffer[i];
    if (b === undefined) continue;
    const isPrintableAscii = b >= 0x20 && b <= 0x7e;
    const isAllowedWhitespace = b === 0x09 || b === 0x0a || b === 0x0d;
    const isUtf8Continuation = b >= 0x80; // permitimos UTF-8 multibyte.
    if (!isPrintableAscii && !isAllowedWhitespace && !isUtf8Continuation) {
      return 'unknown';
    }
  }

  return 'csv';
}

/**
 * MIME types canónicos para los tipos detectados. Útil cuando el controller
 * quiere normalizar el `Content-Type` antes de subir a S3.
 */
export const DETECTED_MIME: Record<Exclude<DetectedFileType, 'unknown'>, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/**
 * Sprint 5 — MT-1. SVG es XML; lo detectamos buscando `<svg` (case-insensitive)
 * dentro de los primeros 1KB. Para evitar falsos positivos contra docs HTML
 * que mencionen `<svg>`, exigimos que el primer non-whitespace char sea `<`
 * (XML/SVG puro). NO ejecutamos el SVG (server-side: el CDN lo sirve como
 * `image/svg+xml`; XSS via `<script>` dentro del SVG es responsabilidad del
 * navegador con CSP — el portal del asegurado deniega scripts inline).
 *
 * **Caveat de seguridad** documentado para el iter 2 / NEW-FINDING:
 * algunos vectores XSS via SVG `<script>` o `onload` siguen siendo posibles
 * si el SVG se embebe inline en HTML. La mitigación es servirlo SIEMPRE
 * como recurso aparte (`<img src=...>`) — eso lo enforza CloudFront +
 * Content-Disposition. Si hace falta hardening server-side (sanitize SVG
 * con `dompurify`/`xmlbuilder`), agregar en Sprint 6 antes de UAT externo.
 */
function isLikelySvg(buffer: Buffer): boolean {
  const sample = buffer.slice(0, Math.min(buffer.length, 1024)).toString('utf8').trimStart();
  if (!sample.startsWith('<')) return false;
  // Aceptamos `<?xml ...?>` opcional al frente.
  const lower = sample.slice(0, 200).toLowerCase();
  return lower.includes('<svg');
}
