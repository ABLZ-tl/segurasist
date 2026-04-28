/**
 * S1 iter 2 — Unit tests para `RealMonthlyReportGenerator`.
 *
 * Cubre:
 *   1. Pipeline happy path: invoca getConciliacionReport con scope BYPASSRLS,
 *      pasa el JSON al pdfRenderer, devuelve {pdf, summary}.
 *   2. Conversión período → ventana ISO (mes con 30 días).
 *   3. Conversión período → ventana ISO (febrero NO bisiesto = 28 días).
 *   4. Conversión período → ventana ISO (febrero bisiesto = 29 días).
 *   5. Conversión período → ventana ISO (diciembre = 31 días).
 *   6. summary.lineCount = altas+bajas+certs.
 */
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { ConciliacionData } from '../../../../src/modules/reports/dto/conciliacion-report.dto';
import { RealMonthlyReportGenerator } from '../../../../src/modules/reports/monthly-report-generator.service';
import { ReportsPdfRendererService } from '../../../../src/modules/reports/reports-pdf-renderer.service';
import { ReportsService } from '../../../../src/modules/reports/reports.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

function build(): {
  generator: RealMonthlyReportGenerator;
  reports: DeepMockProxy<ReportsService>;
  pdfRenderer: DeepMockProxy<ReportsPdfRendererService>;
} {
  const reports = mockDeep<ReportsService>();
  const pdfRenderer = mockDeep<ReportsPdfRendererService>();
  const generator = new RealMonthlyReportGenerator(reports, pdfRenderer);
  return { generator, reports, pdfRenderer };
}

function sampleData(overrides: Partial<ConciliacionData> = {}): ConciliacionData {
  return {
    from: '2026-04-01',
    to: '2026-04-30',
    tenantId: TENANT,
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
    ...overrides,
  };
}

describe('RealMonthlyReportGenerator', () => {
  it('happy path: invoca getConciliacionReport con scope BYPASSRLS y devuelve pdf+summary', async () => {
    const { generator, reports, pdfRenderer } = build();
    reports.getConciliacionReport.mockResolvedValue(sampleData());
    pdfRenderer.renderConciliacionPdf.mockResolvedValue(Buffer.from('%PDF-1.7 mock'));

    const out = await generator.generate({ tenantId: TENANT, period: { year: 2026, month: 4 } });

    expect(reports.getConciliacionReport).toHaveBeenCalledWith(
      '2026-04-01',
      '2026-04-30',
      expect.objectContaining({ platformAdmin: true, tenantId: TENANT }),
    );
    expect(pdfRenderer.renderConciliacionPdf).toHaveBeenCalledTimes(1);
    expect(out.pdf).toBeInstanceOf(Buffer);
    expect(out.pdf.toString('utf8')).toContain('%PDF');
    expect(out.summary).toEqual({ lineCount: 120 + 40 + 95 });
  });

  it('mes con 30 días → window 04-01..04-30', async () => {
    const { generator, reports, pdfRenderer } = build();
    reports.getConciliacionReport.mockResolvedValue(sampleData());
    pdfRenderer.renderConciliacionPdf.mockResolvedValue(Buffer.from('%PDF'));

    await generator.generate({ tenantId: TENANT, period: { year: 2026, month: 4 } });
    expect(reports.getConciliacionReport).toHaveBeenCalledWith('2026-04-01', '2026-04-30', expect.anything());
  });

  it('febrero NO bisiesto (2026) → window 02-01..02-28', async () => {
    const { generator, reports, pdfRenderer } = build();
    reports.getConciliacionReport.mockResolvedValue(sampleData());
    pdfRenderer.renderConciliacionPdf.mockResolvedValue(Buffer.from('%PDF'));

    await generator.generate({ tenantId: TENANT, period: { year: 2026, month: 2 } });
    expect(reports.getConciliacionReport).toHaveBeenCalledWith('2026-02-01', '2026-02-28', expect.anything());
  });

  it('febrero bisiesto (2024) → window 02-01..02-29', async () => {
    const { generator, reports, pdfRenderer } = build();
    reports.getConciliacionReport.mockResolvedValue(sampleData());
    pdfRenderer.renderConciliacionPdf.mockResolvedValue(Buffer.from('%PDF'));

    await generator.generate({ tenantId: TENANT, period: { year: 2024, month: 2 } });
    expect(reports.getConciliacionReport).toHaveBeenCalledWith('2024-02-01', '2024-02-29', expect.anything());
  });

  it('diciembre → window 12-01..12-31', async () => {
    const { generator, reports, pdfRenderer } = build();
    reports.getConciliacionReport.mockResolvedValue(sampleData());
    pdfRenderer.renderConciliacionPdf.mockResolvedValue(Buffer.from('%PDF'));

    await generator.generate({ tenantId: TENANT, period: { year: 2025, month: 12 } });
    expect(reports.getConciliacionReport).toHaveBeenCalledWith('2025-12-01', '2025-12-31', expect.anything());
  });

  it('summary.lineCount = altas + bajas + certs', async () => {
    const { generator, reports, pdfRenderer } = build();
    reports.getConciliacionReport.mockResolvedValue(
      sampleData({ altas: 5, bajas: 3, certificadosEmitidos: 7 }),
    );
    pdfRenderer.renderConciliacionPdf.mockResolvedValue(Buffer.from('%PDF'));

    const out = await generator.generate({ tenantId: TENANT, period: { year: 2026, month: 4 } });
    expect(out.summary).toEqual({ lineCount: 15 });
  });
});
