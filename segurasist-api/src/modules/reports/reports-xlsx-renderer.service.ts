/**
 * S4-01 / S4-03 — Renderer XLSX para reportes (Conciliación, Utilización).
 *
 * Reusa exceljs (ya en deps via reports-worker). Una sheet por reporte;
 * conciliación adicional incluye sheet de breakdown por categoría.
 *
 * Importante: el caller persiste el audit log; este service sólo computa.
 *
 * Tests: el integration spec abre el buffer con `ExcelJS.Workbook().xlsx.load(...)`
 * y verifica las celdas cuadran con la BD.
 */
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { ConciliacionData } from './dto/conciliacion-report.dto';
import type { UtilizacionData } from './dto/utilizacion-report.dto';

@Injectable()
export class ReportsXlsxRendererService {
  async renderConciliacionXlsx(data: ConciliacionData): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SegurAsist';
    wb.created = new Date();

    const ws = wb.addWorksheet('Resumen');
    ws.columns = [
      { header: 'Métrica', key: 'metric', width: 36 },
      { header: 'Valor', key: 'value', width: 22 },
    ];
    ws.addRow({ metric: 'Período (desde)', value: data.from });
    ws.addRow({ metric: 'Período (hasta)', value: data.to });
    ws.addRow({ metric: 'Tenant', value: data.tenantId ?? 'cross-tenant' });
    ws.addRow({});
    ws.addRow({ metric: 'Insureds activos al inicio', value: data.activosInicio });
    ws.addRow({ metric: 'Insureds activos al cierre', value: data.activosCierre });
    ws.addRow({ metric: 'Altas en el período', value: data.altas });
    ws.addRow({ metric: 'Bajas en el período', value: data.bajas });
    ws.addRow({});
    ws.addRow({ metric: 'Certificados emitidos', value: data.certificadosEmitidos });
    ws.addRow({});
    ws.addRow({ metric: 'Claims reportados', value: data.claimsCount });
    ws.addRow({ metric: 'Monto estimado total', value: data.claimsAmountEstimated });
    ws.addRow({ metric: 'Monto aprobado total', value: data.claimsAmountApproved });
    ws.addRow({});
    ws.addRow({ metric: 'Coverage usage count', value: data.coverageUsageCount });
    ws.addRow({ metric: 'Coverage usage amount', value: data.coverageUsageAmount });
    ws.addRow({});
    ws.addRow({ metric: 'Generado', value: data.generatedAt });
    ws.getRow(1).font = { bold: true };

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }

  async renderUtilizacionXlsx(data: UtilizacionData): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SegurAsist';
    wb.created = new Date();

    const wsTop = wb.addWorksheet(`Top-${data.topN}`);
    wsTop.columns = [
      { header: '#', key: 'idx', width: 4 },
      { header: 'Paquete', key: 'pkg', width: 28 },
      { header: 'Cobertura', key: 'cov', width: 28 },
      { header: 'Tipo', key: 'type', width: 16 },
      { header: 'Usos', key: 'count', width: 10 },
      { header: 'Monto', key: 'amount', width: 16 },
    ];
    data.rows.forEach((r, i) => {
      wsTop.addRow({
        idx: i + 1,
        pkg: r.packageName,
        cov: r.coverageName,
        type: r.coverageType,
        count: r.usageCount,
        amount: r.usageAmount,
      });
    });
    wsTop.getRow(1).font = { bold: true };

    const wsAgg = wb.addWorksheet('Por paquete');
    wsAgg.columns = [
      { header: 'Paquete', key: 'pkg', width: 28 },
      { header: 'Usos totales', key: 'count', width: 14 },
      { header: 'Monto total', key: 'amount', width: 16 },
    ];
    data.byPackage.forEach((p) => {
      wsAgg.addRow({ pkg: p.packageName, count: p.totalUsageCount, amount: p.totalUsageAmount });
    });
    wsAgg.getRow(1).font = { bold: true };

    const wsMeta = wb.addWorksheet('Meta');
    wsMeta.columns = [
      { header: 'Campo', key: 'k', width: 18 },
      { header: 'Valor', key: 'v', width: 28 },
    ];
    wsMeta.addRow({ k: 'from', v: data.from });
    wsMeta.addRow({ k: 'to', v: data.to });
    wsMeta.addRow({ k: 'topN', v: data.topN });
    wsMeta.addRow({ k: 'generatedAt', v: data.generatedAt });
    wsMeta.getRow(1).font = { bold: true };

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }
}
