/**
 * S4-01/03 — XLSX renderer unit tests.
 *
 * Verifica:
 *   - Buffer >0 bytes (sanity).
 *   - Magic bytes XLSX (`PK\x03\x04` zip header).
 *   - exceljs puede abrir el buffer y leer las celdas esperadas.
 */
import ExcelJS from 'exceljs';
import type { ConciliacionData } from '../../../../src/modules/reports/dto/conciliacion-report.dto';
import type { UtilizacionData } from '../../../../src/modules/reports/dto/utilizacion-report.dto';
import { ReportsXlsxRendererService } from '../../../../src/modules/reports/reports-xlsx-renderer.service';

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

describe('ReportsXlsxRendererService', () => {
  const svc = new ReportsXlsxRendererService();

  it('renderConciliacionXlsx → buffer XLSX legible con cifras', async () => {
    const data: ConciliacionData = {
      from: '2026-04-01',
      to: '2026-04-30',
      tenantId: '11111111-1111-1111-1111-111111111111',
      activosInicio: 1000,
      activosCierre: 1080,
      altas: 120,
      bajas: 40,
      certificadosEmitidos: 95,
      claimsCount: 12,
      claimsAmountEstimated: 50_000,
      claimsAmountApproved: 30_000,
      coverageUsageCount: 250,
      coverageUsageAmount: 75_500.5,
      generatedAt: '2026-04-27T12:00:00.000Z',
    };
    const buf = await svc.renderConciliacionXlsx(data);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Resumen');
    expect(ws).toBeDefined();
    // Buscamos la fila con "Insureds activos al cierre".
    let found = false;
    ws?.eachRow((row) => {
      const a = row.getCell(1).value;
      const b = row.getCell(2).value;
      if (a === 'Insureds activos al cierre' && b === 1080) found = true;
    });
    expect(found).toBe(true);
  });

  it('renderUtilizacionXlsx → 3 sheets (Top-N, Por paquete, Meta)', async () => {
    const data: UtilizacionData = {
      from: '2026-04-01',
      to: '2026-04-30',
      topN: 3,
      rows: [
        {
          packageId: 'p1',
          packageName: 'Plan A',
          coverageId: 'c1',
          coverageName: 'Hospital',
          coverageType: 'count_based',
          usageCount: 50,
          usageAmount: 1000,
        },
      ],
      byPackage: [{ packageId: 'p1', packageName: 'Plan A', totalUsageCount: 50, totalUsageAmount: 1000 }],
      generatedAt: '2026-04-27T12:00:00.000Z',
    };
    const buf = await svc.renderUtilizacionXlsx(data);
    expect(buf.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(
      expect.arrayContaining(['Top-3', 'Por paquete', 'Meta']),
    );
  });

  it('renderUtilizacionXlsx con rows=[] sigue produciendo buffer válido', async () => {
    const data: UtilizacionData = {
      from: '2026-04-01',
      to: '2026-04-30',
      topN: 10,
      rows: [],
      byPackage: [],
      generatedAt: '2026-04-27T12:00:00.000Z',
    };
    const buf = await svc.renderUtilizacionXlsx(data);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
  });
});
