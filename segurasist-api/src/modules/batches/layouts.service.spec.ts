import ExcelJS from 'exceljs';
import { LayoutsService } from './layouts.service';

describe('LayoutsService', () => {
  const svc = new LayoutsService();

  describe('generateInsuredsTemplate()', () => {
    let buffer: Buffer;

    beforeAll(async () => {
      buffer = await svc.generateInsuredsTemplate();
    });

    it('devuelve un Buffer no vacío >1KB', () => {
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(1024);
    });

    it('empieza con la firma ZIP magic bytes (XLSX es ZIP)', () => {
      expect(buffer[0]).toBe(0x50);
      expect(buffer[1]).toBe(0x4b);
      expect(buffer[2]).toBe(0x03);
      expect(buffer[3]).toBe(0x04);
    });

    it('cada llamada produce un buffer válido (no comparte estado mutable)', async () => {
      const a = await svc.generateInsuredsTemplate();
      const b = await svc.generateInsuredsTemplate();
      expect(a.length).toBeGreaterThan(1024);
      expect(b.length).toBeGreaterThan(1024);
    });

    describe('parsing del XLSX generado', () => {
      let wb: ExcelJS.Workbook;

      beforeAll(async () => {
        wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
      });

      it('contiene exactamente 3 hojas: Asegurados, Instrucciones, Catálogos', () => {
        const names = wb.worksheets.map((w) => w.name);
        expect(names).toEqual(['Asegurados', 'Instrucciones', 'Catálogos']);
      });

      it('hoja "Asegurados": headers row 1 matchean la lista exacta', () => {
        const ws = wb.getWorksheet('Asegurados');
        if (!ws) throw new Error('hoja Asegurados ausente');
        const expected = [
          'CURP',
          'Nombre completo',
          'Fecha nacimiento',
          'Género',
          'Email',
          'Teléfono',
          'Paquete',
          'Vigencia inicio',
          'Vigencia fin',
          'Dependientes',
          'Notas',
        ];
        const actual = expected.map((_, i) => {
          const cell = ws.getRow(1).getCell(i + 1);
          return typeof cell.value === 'string' ? cell.value : String(cell.value);
        });
        expect(actual).toEqual(expected);
      });

      it('hoja "Asegurados": header row 1 está en bold con fondo gris', () => {
        const ws = wb.getWorksheet('Asegurados');
        if (!ws) throw new Error('hoja Asegurados ausente');
        const cell = ws.getRow(1).getCell(1);
        expect(cell.font?.bold).toBe(true);
        const fill = cell.fill as ExcelJS.FillPattern | undefined;
        expect(fill?.type).toBe('pattern');
        expect((fill?.fgColor?.argb ?? '').toUpperCase()).toBe('FFE5E7EB');
      });

      it('hoja "Asegurados": sub-row 2 tiene texto en cursiva con ejemplos esperados', () => {
        const ws = wb.getWorksheet('Asegurados');
        if (!ws) throw new Error('hoja Asegurados ausente');
        const subRow = ws.getRow(2);
        const curpCell = subRow.getCell(1);
        expect(curpCell.font?.italic).toBe(true);
        const curpVal = typeof curpCell.value === 'string' ? curpCell.value : String(curpCell.value);
        expect(curpVal).toContain('HEGM860519MJCRRN08');

        const paqueteCell = subRow.getCell(7);
        const paqueteVal =
          typeof paqueteCell.value === 'string' ? paqueteCell.value : String(paqueteCell.value);
        expect(paqueteVal).toContain('Premium');

        const fechaCell = subRow.getCell(3);
        const fechaVal = typeof fechaCell.value === 'string' ? fechaCell.value : String(fechaCell.value);
        expect(fechaVal).toContain('1986-05-19');
      });

      it('hoja "Asegurados": freeze pane en row 2', () => {
        const ws = wb.getWorksheet('Asegurados');
        if (!ws) throw new Error('hoja Asegurados ausente');
        const view = ws.views?.[0] as { state?: string; ySplit?: number } | undefined;
        expect(view?.state).toBe('frozen');
        expect(view?.ySplit).toBe(2);
      });

      it('hoja "Asegurados": no hay data rows más allá de la sub-row 2', () => {
        const ws = wb.getWorksheet('Asegurados');
        if (!ws) throw new Error('hoja Asegurados ausente');
        const row3 = ws.getRow(3);
        // Row 3 puede existir como objeto pero todas las celdas deben estar vacías.
        const hasContent = (row3.values as unknown[]).some((v) => v !== null && v !== undefined && v !== '');
        expect(hasContent).toBe(false);
      });

      it('hoja "Instrucciones": A1 contiene "DEMO"', () => {
        const ws = wb.getWorksheet('Instrucciones');
        if (!ws) throw new Error('hoja Instrucciones ausente');
        const a1 = ws.getCell('A1').value;
        const text = typeof a1 === 'string' ? a1 : String(a1);
        expect(text).toContain('DEMO');
        expect(text).toContain('Layout SegurAsist');
      });

      it('hoja "Instrucciones": menciona MAC-002 y formato YYYY-MM-DD', () => {
        const ws = wb.getWorksheet('Instrucciones');
        if (!ws) throw new Error('hoja Instrucciones ausente');
        let combined = '';
        ws.eachRow((row) => {
          row.eachCell((cell) => {
            combined += typeof cell.value === 'string' ? cell.value : String(cell.value);
            combined += '\n';
          });
        });
        expect(combined).toContain('MAC-002');
        expect(combined).toContain('YYYY-MM-DD');
        expect(combined).toContain('ops@segurasist.app');
      });

      it('hoja "Catálogos": columna A tiene los 3 paquetes esperados', () => {
        const ws = wb.getWorksheet('Catálogos');
        if (!ws) throw new Error('hoja Catálogos ausente');
        expect(ws.getCell('A1').value).toBe('Paquetes');
        expect(ws.getCell('A2').value).toBe('Básico');
        expect(ws.getCell('A3').value).toBe('Premium');
        expect(ws.getCell('A4').value).toBe('Platinum');
      });

      it('hoja "Catálogos": columna B tiene M / F', () => {
        const ws = wb.getWorksheet('Catálogos');
        if (!ws) throw new Error('hoja Catálogos ausente');
        expect(ws.getCell('B1').value).toBe('Géneros');
        expect(ws.getCell('B2').value).toBe('M');
        expect(ws.getCell('B3').value).toBe('F');
      });
    });
  });
});
