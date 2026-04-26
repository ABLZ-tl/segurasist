import { BatchesParserService } from '@modules/batches/parser/batches-parser.service';
import { ParserError } from '@modules/batches/parser/types';
import ExcelJS from 'exceljs';

describe('BatchesParserService', () => {
  const svc = new BatchesParserService();

  // -------------------------------------------------------------------------
  // helpers para fabricar buffers XLSX/CSV en memoria.
  // -------------------------------------------------------------------------
  async function makeXlsx(opts: {
    sheetName?: string;
    headers: string[];
    data: Array<Array<string | number | Date | undefined>>;
  }): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(opts.sheetName ?? 'Asegurados');
    ws.addRow(opts.headers);
    for (const row of opts.data) {
      ws.addRow(row);
    }
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
  }

  function makeCsv(headers: string[], data: string[][]): Buffer {
    const lines = [headers.join(','), ...data.map((r) => r.join(','))];
    return Buffer.from(lines.join('\n'), 'utf8');
  }

  // -------------------------------------------------------------------------
  // parseXlsx — happy path
  // -------------------------------------------------------------------------
  describe('parseXlsx — happy path', () => {
    it('parsea 1 fila con todos los headers oficiales', async () => {
      const buf = await makeXlsx({
        headers: [
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
        ],
        data: [
          [
            'HEGM860519MJCRRN08',
            'HEGM860519XXX',
            'María Hernández',
            '1986-05-19',
            'maria@example.com',
            '+525512345678',
            'Premium',
            '2026-01-01',
            '2026-12-31',
            'SNTE',
            'EMP-001',
            'Hijo|2010-03-01|child',
          ],
        ],
      });
      const rows = await svc.parseXlsx(buf);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rowNumber).toBe(2);
      expect(rows[0]!.raw.curp).toBe('HEGM860519MJCRRN08');
      expect(rows[0]!.raw.nombre_completo).toBe('María Hernández');
      expect(rows[0]!.raw.paquete).toBe('Premium');
      expect(rows[0]!.raw.beneficiarios).toBe('Hijo|2010-03-01|child');
    });

    it('reconoce headers en mayúsculas con acentos y espacios', async () => {
      const buf = await makeXlsx({
        headers: ['CURP', 'Nombre Completo', 'Fecha de Nacimiento', 'Paquete'],
        data: [['HEGM860519MJCRRN08', 'Foo', '1990-01-01', 'Básico']],
      });
      const rows = await svc.parseXlsx(buf);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.raw.curp).toBe('HEGM860519MJCRRN08');
      expect(rows[0]!.raw.nombre_completo).toBe('Foo');
      expect(rows[0]!.raw.fecha_nacimiento).toBe('1990-01-01');
      expect(rows[0]!.raw.paquete).toBe('Básico');
    });

    it('toma la hoja "Asegurados" cuando hay varias hojas', async () => {
      const wb = new ExcelJS.Workbook();
      const other = wb.addWorksheet('Catalogos');
      other.addRow(['x', 'y']);
      other.addRow(['1', '2']);
      const ws = wb.addWorksheet('Asegurados');
      ws.addRow(['curp', 'paquete']);
      ws.addRow(['HEGM860519MJCRRN08', 'Premium']);
      const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
      const rows = await svc.parseXlsx(buf);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.raw.paquete).toBe('Premium');
    });

    it('ignora filas vacías intermedias', async () => {
      const buf = await makeXlsx({
        headers: ['curp', 'paquete'],
        data: [
          ['HEGM860519MJCRRN08', 'Premium'],
          ['', ''],
          ['BADM900315HDFRRR05', 'Básico'],
        ],
      });
      const rows = await svc.parseXlsx(buf);
      // exceljs `eachRow({ includeEmpty: false })` skipa la fila completa vacía.
      expect(rows).toHaveLength(2);
      expect(rows[0]!.rowNumber).toBe(2);
      // La segunda fila ocupa la posición original 4 si exceljs no la incluyó.
      // No verificamos el rowNumber exacto de la 2ª fila — sólo que sigue presente.
      expect(rows.map((r) => r.raw.curp)).toEqual(['HEGM860519MJCRRN08', 'BADM900315HDFRRR05']);
    });

    it('convierte celdas Date a ISO YYYY-MM-DD', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Asegurados');
      ws.addRow(['curp', 'fecha_nacimiento']);
      // Fecha en UTC para evitar drift por TZ.
      ws.addRow(['HEGM860519MJCRRN08', new Date(Date.UTC(1990, 0, 15))]);
      const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
      const rows = await svc.parseXlsx(buf);
      expect(rows[0]!.raw.fecha_nacimiento).toBe('1990-01-15');
    });

    it('trims whitespace en celdas string', async () => {
      const buf = await makeXlsx({
        headers: ['curp', 'paquete'],
        data: [['  HEGM860519MJCRRN08  ', '  Premium  ']],
      });
      const rows = await svc.parseXlsx(buf);
      expect(rows[0]!.raw.curp).toBe('HEGM860519MJCRRN08');
      expect(rows[0]!.raw.paquete).toBe('Premium');
    });

    it('descarta columnas con headers no reconocidos pero conserva las válidas', async () => {
      const buf = await makeXlsx({
        headers: ['curp', 'columna_extraña', 'paquete'],
        data: [['HEGM860519MJCRRN08', 'foo', 'Premium']],
      });
      const rows = await svc.parseXlsx(buf);
      expect(rows[0]!.raw.curp).toBe('HEGM860519MJCRRN08');
      expect(rows[0]!.raw.paquete).toBe('Premium');
      expect(rows[0]!.raw.columna_extraña).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // parseXlsx — error paths
  // -------------------------------------------------------------------------
  describe('parseXlsx — errores', () => {
    it('rechaza buffer vacío con EMPTY_FILE', async () => {
      await expect(svc.parseXlsx(Buffer.alloc(0))).rejects.toMatchObject({
        name: 'ParserError',
        code: 'EMPTY_FILE',
      });
    });

    it('rechaza buffer corrupto con UNSUPPORTED_FILE', async () => {
      // ZIP signature pero contenido basura.
      const garbage = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 0xff)]);
      await expect(svc.parseXlsx(garbage)).rejects.toMatchObject({
        name: 'ParserError',
        code: 'UNSUPPORTED_FILE',
      });
    });

    it('rechaza XLSX con hoja sin headers reconocidos → NO_HEADER', async () => {
      const buf = await makeXlsx({
        headers: ['totalmente_inventado', 'otra_columna'],
        data: [['x', 'y']],
      });
      await expect(svc.parseXlsx(buf)).rejects.toMatchObject({
        name: 'ParserError',
        code: 'NO_HEADER',
      });
    });

    it('cae en hoja "asegurados" aunque venga con casing distinto', async () => {
      const buf = await makeXlsx({
        sheetName: 'ASEGURADOS',
        headers: ['curp'],
        data: [['HEGM860519MJCRRN08']],
      });
      const rows = await svc.parseXlsx(buf);
      expect(rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // parseCsv — happy
  // -------------------------------------------------------------------------
  describe('parseCsv — happy', () => {
    it('parsea CSV básico UTF-8', () => {
      const buf = makeCsv(['curp', 'paquete'], [['HEGM860519MJCRRN08', 'Premium']]);
      const rows = svc.parseCsv(buf);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.raw.curp).toBe('HEGM860519MJCRRN08');
      expect(rows[0]!.raw.paquete).toBe('Premium');
      expect(rows[0]!.rowNumber).toBe(2);
    });

    it('parsea CSV con BOM UTF-8', () => {
      const text = 'curp,paquete\nHEGM860519MJCRRN08,Premium\n';
      const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
      const rows = svc.parseCsv(buf);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.raw.curp).toBe('HEGM860519MJCRRN08');
    });

    it('parsea CSV con \\r\\n line endings', () => {
      const buf = Buffer.from(
        'curp,paquete\r\nHEGM860519MJCRRN08,Premium\r\nBADM900315HDFRRR05,Básico\r\n',
        'utf8',
      );
      const rows = svc.parseCsv(buf);
      expect(rows).toHaveLength(2);
    });

    it('parsea celdas con comas dentro de comillas', () => {
      const buf = Buffer.from('curp,nombre_completo\nHEGM860519MJCRRN08,"García, María"\n', 'utf8');
      const rows = svc.parseCsv(buf);
      expect(rows[0]!.raw.nombre_completo).toBe('García, María');
    });

    it('parsea comillas escapadas como ""', () => {
      const buf = Buffer.from('curp,nombre_completo\nHEGM860519MJCRRN08,"Juan ""El Tigre"" Pérez"\n', 'utf8');
      const rows = svc.parseCsv(buf);
      expect(rows[0]!.raw.nombre_completo).toBe('Juan "El Tigre" Pérez');
    });

    it('ignora filas vacías intermedias en CSV', () => {
      const buf = Buffer.from(
        'curp,paquete\nHEGM860519MJCRRN08,Premium\n\nBADM900315HDFRRR05,Básico\n',
        'utf8',
      );
      const rows = svc.parseCsv(buf);
      expect(rows).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // parseCsv — errores
  // -------------------------------------------------------------------------
  describe('parseCsv — errores', () => {
    it('rechaza buffer vacío', () => {
      expect(() => svc.parseCsv(Buffer.alloc(0))).toThrow(ParserError);
    });

    it('rechaza encoding Latin-1 (acentos en byte único 0xE1, etc.)', () => {
      // 0xE1 = 'á' en Latin-1 pero NO es UTF-8 válido (debería ser C3 A1).
      const latin1 = Buffer.from([
        // header: "curp,paquete\n"
        0x63, 0x75, 0x72, 0x70, 0x2c, 0x70, 0x61, 0x71, 0x75, 0x65, 0x74, 0x65, 0x0a,
        // row: "BÁS,HEGM..." — 0xC1 = 'Á' en Latin-1 (inválido como leading UTF-8 byte).
        0xc1, 0x53, 0x2c, 0x42, 0xe1, 0x73, 0x69, 0x63, 0x6f, 0x0a,
      ]);
      expect(() => svc.parseCsv(latin1)).toThrow(/UTF-8|encoding/i);
    });

    it('rechaza CSV solo con whitespace', () => {
      const buf = Buffer.from('   \n\n  \n', 'utf8');
      expect(() => svc.parseCsv(buf)).toThrow(ParserError);
    });

    it('rechaza CSV con headers no reconocidos', () => {
      const buf = Buffer.from('foo,bar\n1,2\n', 'utf8');
      let captured: unknown;
      try {
        svc.parseCsv(buf);
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeInstanceOf(ParserError);
      expect((captured as ParserError).code).toBe('NO_HEADER');
    });
  });
});
