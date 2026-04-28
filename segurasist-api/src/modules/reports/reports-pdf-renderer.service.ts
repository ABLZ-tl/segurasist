/**
 * S4-01 — Renderer PDF de los reportes (Conciliación / Utilización).
 *
 * Reusa `PuppeteerService` (singleton del módulo Certificates). NO requiere
 * el patrón 2-pass de los certificados (no incrustamos QR ni firma SHA en
 * el documento), una sola pasada basta.
 *
 * Templates HTML inline para que el bundle no requiera filesystem en runtime
 * Lambda (Sprint 5: si el set crece, mover a `/templates/` con loader).
 *
 * Importante: el caller persiste el audit log; este service sólo computa.
 */
import { PuppeteerService } from '@modules/certificates/puppeteer.service';
import { Injectable, Logger } from '@nestjs/common';
import type { ConciliacionData } from './dto/conciliacion-report.dto';
import type { UtilizacionData } from './dto/utilizacion-report.dto';

@Injectable()
export class ReportsPdfRendererService {
  private readonly log = new Logger(ReportsPdfRendererService.name);

  constructor(private readonly puppeteer: PuppeteerService) {}

  async renderConciliacionPdf(data: ConciliacionData): Promise<Buffer> {
    const html = this.conciliacionHtml(data);
    const result = await this.puppeteer.renderPdf({
      html,
      ref: `conciliacion-${data.from}-${data.to}`,
      format: 'A4',
      timeoutMs: 30_000,
    });
    this.log.log(
      { from: data.from, to: data.to, ms: result.durationMs, bytes: result.pdf.length },
      'conciliacion pdf rendered',
    );
    return result.pdf;
  }

  async renderUtilizacionPdf(data: UtilizacionData): Promise<Buffer> {
    const html = this.utilizacionHtml(data);
    const result = await this.puppeteer.renderPdf({
      html,
      ref: `utilizacion-${data.from}-${data.to}`,
      format: 'A4',
      timeoutMs: 30_000,
    });
    this.log.log(
      { from: data.from, to: data.to, topN: data.topN, ms: result.durationMs, bytes: result.pdf.length },
      'utilizacion pdf rendered',
    );
    return result.pdf;
  }

  private conciliacionHtml(d: ConciliacionData): string {
    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Reporte de conciliación ${escapeHtml(d.from)} → ${escapeHtml(d.to)}</title>
  <style>${BASE_CSS}</style>
</head>
<body>
  <h1>Reporte de conciliación mensual</h1>
  <div class="meta">
    Período: <b>${escapeHtml(d.from)}</b> → <b>${escapeHtml(d.to)}</b>
    &middot; tenant ${escapeHtml(d.tenantId ?? 'cross-tenant')}
    &middot; generado ${escapeHtml(d.generatedAt)}
  </div>

  <h2>Población de asegurados</h2>
  <table>
    <tbody>
      <tr><th>Activos al inicio</th><td>${fmtInt(d.activosInicio)}</td></tr>
      <tr><th>Activos al cierre</th><td>${fmtInt(d.activosCierre)}</td></tr>
      <tr><th>Altas en el período</th><td>${fmtInt(d.altas)}</td></tr>
      <tr><th>Bajas en el período</th><td>${fmtInt(d.bajas)}</td></tr>
    </tbody>
  </table>

  <h2>Emisión de certificados</h2>
  <table>
    <tbody>
      <tr><th>Certificados emitidos</th><td>${fmtInt(d.certificadosEmitidos)}</td></tr>
    </tbody>
  </table>

  <h2>Siniestralidad</h2>
  <table>
    <tbody>
      <tr><th>Claims reportados</th><td>${fmtInt(d.claimsCount)}</td></tr>
      <tr><th>Monto estimado total</th><td>${fmtMoney(d.claimsAmountEstimated)}</td></tr>
      <tr><th>Monto aprobado total</th><td>${fmtMoney(d.claimsAmountApproved)}</td></tr>
    </tbody>
  </table>

  <h2>Utilización de cobertura</h2>
  <table>
    <tbody>
      <tr><th>Usos registrados</th><td>${fmtInt(d.coverageUsageCount)}</td></tr>
      <tr><th>Monto utilizado</th><td>${fmtMoney(d.coverageUsageAmount)}</td></tr>
    </tbody>
  </table>

  <p class="footer">Documento generado automáticamente por SegurAsist. Las cifras provienen de la base de datos transaccional al momento de la generación.</p>
</body>
</html>`;
  }

  private utilizacionHtml(d: UtilizacionData): string {
    const rowsHtml = d.rows
      .map(
        (r, i) => `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.packageName)}</td>
          <td>${escapeHtml(r.coverageName)}</td>
          <td>${escapeHtml(r.coverageType)}</td>
          <td class="num">${fmtInt(r.usageCount)}</td>
          <td class="num">${fmtMoney(r.usageAmount)}</td>
        </tr>`,
      )
      .join('\n');
    const aggHtml = d.byPackage
      .map(
        (p) => `<tr>
          <td>${escapeHtml(p.packageName)}</td>
          <td class="num">${fmtInt(p.totalUsageCount)}</td>
          <td class="num">${fmtMoney(p.totalUsageAmount)}</td>
        </tr>`,
      )
      .join('\n');
    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Utilización por cobertura ${escapeHtml(d.from)} → ${escapeHtml(d.to)}</title>
  <style>${BASE_CSS}</style>
</head>
<body>
  <h1>Reporte de utilización por cobertura</h1>
  <div class="meta">
    Período: <b>${escapeHtml(d.from)}</b> → <b>${escapeHtml(d.to)}</b>
    &middot; Top-${d.topN}
    &middot; generado ${escapeHtml(d.generatedAt)}
  </div>

  <h2>Top-${d.topN} consumidores (paquete × cobertura)</h2>
  <table>
    <thead>
      <tr><th>#</th><th>Paquete</th><th>Cobertura</th><th>Tipo</th><th>Usos</th><th>Monto</th></tr>
    </thead>
    <tbody>${rowsHtml || '<tr><td colspan="6">Sin datos en el período.</td></tr>'}</tbody>
  </table>

  <h2>Agregado por paquete</h2>
  <table>
    <thead>
      <tr><th>Paquete</th><th>Usos totales</th><th>Monto total</th></tr>
    </thead>
    <tbody>${aggHtml || '<tr><td colspan="3">Sin datos en el período.</td></tr>'}</tbody>
  </table>
</body>
</html>`;
  }
}

const BASE_CSS = `
  body { font-family: -apple-system, system-ui, sans-serif; font-size: 11px; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #e3e3e3; }
  .meta { font-size: 10px; color: #666; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  th { background: #f4f4f4; font-weight: 600; }
  tr:nth-child(even) td { background: #fbfbfb; }
  .footer { font-size: 9px; color: #888; margin-top: 16px; }
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtInt(n: number): string {
  return new Intl.NumberFormat('es-MX').format(n);
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}
