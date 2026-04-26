import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

// Provisional hasta que MAC-002 (validación de columnas con la doctora Lucía)
// desbloquee el layout oficial. La generación se hace on-the-fly en memoria
// para que cuando se intercambien las columnas no haya que tocar el contrato
// del endpoint ni reemplazar binarios checkeados al repo.
export const INSUREDS_TEMPLATE_FILENAME = 'segurasist-layout-asegurados-v0.xlsx';
export const INSUREDS_TEMPLATE_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface ColumnDef {
  header: string;
  example: string;
  description: string;
  width: number;
}

const COLUMNS: ColumnDef[] = [
  { header: 'CURP', example: 'HEGM860519MJCRRN08', description: 'CURP MX, 18 caracteres', width: 22 },
  {
    header: 'Nombre completo',
    example: 'María Hernández García',
    description: 'string ≤120, requerido',
    width: 32,
  },
  {
    header: 'Fecha nacimiento',
    example: '1986-05-19',
    description: 'YYYY-MM-DD',
    width: 16,
  },
  { header: 'Género', example: 'F', description: 'M / F', width: 10 },
  {
    header: 'Email',
    example: 'maria@example.com',
    description: 'formato email RFC',
    width: 28,
  },
  { header: 'Teléfono', example: '5512345678', description: '10 dígitos', width: 14 },
  {
    header: 'Paquete',
    example: 'Premium',
    description: 'Básico / Premium / Platinum',
    width: 14,
  },
  { header: 'Vigencia inicio', example: '2026-01-01', description: 'YYYY-MM-DD', width: 16 },
  { header: 'Vigencia fin', example: '2026-12-31', description: 'YYYY-MM-DD', width: 16 },
  { header: 'Dependientes', example: '2', description: 'entero 0..10', width: 14 },
  { header: 'Notas', example: 'Padecimientos previos', description: 'string ≤500, opcional', width: 36 },
];

const PAQUETES = ['Básico', 'Premium', 'Platinum'];
const GENEROS = ['M', 'F'];

const HEADER_FILL = 'FFE5E7EB';
const SUBROW_FILL = 'FFF9FAFB';

@Injectable()
export class LayoutsService {
  async generateInsuredsTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SegurAsist';
    wb.created = new Date();

    this.buildAsegurados(wb);
    this.buildInstrucciones(wb);
    this.buildCatalogos(wb);

    const out = await wb.xlsx.writeBuffer();
    // exceljs returns ArrayBuffer-like; convert to Node Buffer.
    return Buffer.from(out as ArrayBuffer);
  }

  private buildAsegurados(wb: ExcelJS.Workbook): void {
    const ws = wb.addWorksheet('Asegurados', {
      views: [{ state: 'frozen', ySplit: 2 }],
    });

    ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.header, width: c.width }));

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      cell.border = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    const subRow = ws.getRow(2);
    COLUMNS.forEach((col, idx) => {
      const cell = subRow.getCell(idx + 1);
      cell.value = `${col.example} — ${col.description}`;
      cell.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBROW_FILL } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });
    subRow.commit();
  }

  private buildInstrucciones(wb: ExcelJS.Workbook): void {
    const ws = wb.addWorksheet('Instrucciones');
    ws.getColumn(1).width = 110;

    const title = ws.getCell('A1');
    title.value = 'Layout SegurAsist — Carga masiva de asegurados (DEMO)';
    title.font = { bold: true, size: 14 };

    const bullets = [
      'Versión: demo v0 (provisional hasta validación de MAC-002 con la doctora Lucía)',
      'Cualquier celda fuera del rango de columnas oficiales será ignorada',
      'Tamaño máximo: 10,000 filas por archivo',
      'Formatos soportados: .xlsx (Excel 2007+)',
      'Las fechas deben venir como `YYYY-MM-DD`, no como número serial de Excel',
      'Si una fila tiene errores de validación, la API devuelve un job con preview y la fila se marca pero el resto del lote sigue procesándose en estado `preview_ready`',
      'Contacto: ops@segurasist.app',
    ];
    bullets.forEach((b, i) => {
      const cell = ws.getCell(`A${i + 3}`);
      cell.value = `• ${b}`;
      cell.alignment = { wrapText: true, vertical: 'top' };
    });

    const footer = ws.getCell(`A${bullets.length + 5}`);
    footer.value = '© Hospitales MAC — generado dinámicamente, no editar el archivo template';
    footer.font = { italic: true, size: 9, color: { argb: 'FF9CA3AF' } };
  }

  private buildCatalogos(wb: ExcelJS.Workbook): void {
    const ws = wb.addWorksheet('Catálogos');
    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 12;

    const headerA = ws.getCell('A1');
    headerA.value = 'Paquetes';
    headerA.font = { bold: true };
    PAQUETES.forEach((p, i) => {
      ws.getCell(`A${i + 2}`).value = p;
    });

    const headerB = ws.getCell('B1');
    headerB.value = 'Géneros';
    headerB.font = { bold: true };
    GENEROS.forEach((g, i) => {
      ws.getCell(`B${i + 2}`).value = g;
    });

    // Best-effort write-protection: exceljs sheet protection. La password local
    // no existe — solo marcamos la hoja como read-only para que no se edite
    // accidentalmente al abrir el template. El frontend nunca debe leer de aquí.
    void ws.protect('segurasist-readonly', {
      selectLockedCells: true,
      selectUnlockedCells: true,
    });
  }
}
