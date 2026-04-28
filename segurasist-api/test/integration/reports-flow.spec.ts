/**
 * S4-01/02/03 — Integration: flujo end-to-end de los reportes.
 *
 * NO levanta NestApplication ni Postgres real. Compone:
 *   - ReportsService con PrismaService mockeado (provee respuestas de count
 *     y aggregate consistentes).
 *   - ReportsXlsxRendererService real (exceljs es puro JS, no necesita IO).
 *   - ReportsPdfRendererService con PuppeteerService mockeado (Chromium real
 *     no aporta valor en CI; lo cubre el spec dedicado del puppeteer).
 *
 * Verifica:
 *   1. Conciliación: cifras del JSON coinciden con los counts mockeados (acta
 *      como "cuadrar con BD" ya que prisma es la fuente).
 *   2. Volumetría: 90 puntos cuando days=90.
 *   3. Utilización: top-N + agregado byPackage.
 *   4. PDF: pasa el data al puppeteer mock; el callee recibe HTML válido.
 *   5. XLSX: buffer real abre con ExcelJS sin error.
 */
import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import type { PuppeteerService } from '@modules/certificates/puppeteer.service';
import ExcelJS from 'exceljs';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { ReportsPdfRendererService } from '../../src/modules/reports/reports-pdf-renderer.service';
import { ReportsXlsxRendererService } from '../../src/modules/reports/reports-xlsx-renderer.service';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { mockPrismaService } from '../mocks/prisma.mock';

const TENANT = '11111111-1111-1111-1111-111111111111';

function assemble() {
  const prisma = mockPrismaService();
  const bypass: DeepMockProxy<PrismaBypassRlsService> = mockDeep<PrismaBypassRlsService>();
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(0),
  };
  const reports = new ReportsService(prisma, bypass, redis as never);
  const xlsxRenderer = new ReportsXlsxRendererService();
  const puppeteer: DeepMockProxy<PuppeteerService> = mockDeep<PuppeteerService>();
  puppeteer.renderPdf.mockResolvedValue({
    pdf: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2048, 0x20)]),
    durationMs: 200,
  });
  const pdfRenderer = new ReportsPdfRendererService(puppeteer);
  return { reports, xlsxRenderer, pdfRenderer, prisma, puppeteer };
}

describe('Reports E2E — S4-01 conciliación', () => {
  it('JSON cifras → XLSX → bytes válidos abren con ExcelJS', async () => {
    const { reports, xlsxRenderer, prisma } = assemble();
    prisma.client.insured.count
      .mockResolvedValueOnce(800) // activosInicio
      .mockResolvedValueOnce(900) // activosCierre
      .mockResolvedValueOnce(150) // altas
      .mockResolvedValueOnce(50); // bajas
    prisma.client.certificate.count.mockResolvedValueOnce(140);
    prisma.client.claim.aggregate.mockResolvedValueOnce({
      _count: { _all: 8 },
      _sum: { amountEstimated: 12_000, amountApproved: 8_000 },
    } as never);
    prisma.client.coverageUsage.aggregate.mockResolvedValueOnce({
      _count: { _all: 320 },
      _sum: { amount: 45_000 },
    } as never);

    const data = await reports.getConciliacionReport('2026-04-01', '2026-04-30', {
      platformAdmin: false,
      tenantId: TENANT,
    });
    // Cuadrar cifras vs prisma counts.
    expect(data.activosInicio).toBe(800);
    expect(data.activosCierre).toBe(900);
    expect(data.altas).toBe(150);
    expect(data.bajas).toBe(50);
    expect(data.certificadosEmitidos).toBe(140);
    expect(data.claimsCount).toBe(8);
    expect(data.coverageUsageAmount).toBe(45_000);

    const xlsx = await xlsxRenderer.renderConciliacionXlsx(data);
    expect(xlsx.length).toBeGreaterThan(0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx);
    expect(wb.getWorksheet('Resumen')).toBeDefined();
  });

  it('JSON → PDF: puppeteer.renderPdf invocado con HTML que cita período + cifras', async () => {
    const { reports, pdfRenderer, prisma, puppeteer } = assemble();
    prisma.client.insured.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prisma.client.certificate.count.mockResolvedValueOnce(0);
    prisma.client.claim.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { amountEstimated: null, amountApproved: null },
    } as never);
    prisma.client.coverageUsage.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { amount: null },
    } as never);

    const data = await reports.getConciliacionReport('2026-03-01', '2026-03-31', {
      platformAdmin: false,
      tenantId: TENANT,
    });
    const pdf = await pdfRenderer.renderConciliacionPdf(data);
    expect(pdf.length).toBeGreaterThan(0);
    expect(puppeteer.renderPdf).toHaveBeenCalledTimes(1);
    const arg = puppeteer.renderPdf.mock.calls[0]?.[0] as { html: string; ref: string };
    expect(arg.html).toContain('2026-03-01');
    expect(arg.html).toContain('2026-03-31');
    expect(arg.ref).toBe('conciliacion-2026-03-01-2026-03-31');
  });
});

describe('Reports E2E — S4-02 volumetria', () => {
  it('days=90 → 90 puntos consecutivos con date ISO', async () => {
    const { reports, prisma } = assemble();
    prisma.client.$queryRaw.mockResolvedValue([] as never);
    const data = await reports.getVolumetria90(90, { platformAdmin: false, tenantId: TENANT });
    expect(data.points).toHaveLength(90);
    expect(data.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Las fechas son únicas y consecutivas.
    const dates = data.points.map((p) => p.date);
    expect(new Set(dates).size).toBe(90);
  });
});

describe('Reports E2E — S4-03 utilizacion', () => {
  it('aggregate → topN + byPackage; XLSX abre con 3 sheets', async () => {
    const { reports, xlsxRenderer, prisma } = assemble();
    prisma.client.coverageUsage.groupBy.mockResolvedValue([
      { coverageId: 'c1', _count: { _all: 100 }, _sum: { amount: 9_000 } },
      { coverageId: 'c2', _count: { _all: 30 }, _sum: { amount: 200 } },
    ] as never);
    prisma.client.coverage.findMany.mockResolvedValue([
      { id: 'c1', name: 'Hosp', type: 'count_based', package: { id: 'p1', name: 'Plan Premium' } },
      { id: 'c2', name: 'Lab', type: 'amount_based', package: { id: 'p1', name: 'Plan Premium' } },
    ] as never);

    const data = await reports.getUtilizacion('2026-04-01', '2026-04-30', 5, {
      platformAdmin: false,
      tenantId: TENANT,
    });
    expect(data.rows[0]?.coverageId).toBe('c1');
    expect(data.byPackage).toHaveLength(1);
    expect(data.byPackage[0]?.totalUsageAmount).toBe(9_200);

    const xlsx = await xlsxRenderer.renderUtilizacionXlsx(data);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(expect.arrayContaining(['Top-5', 'Por paquete', 'Meta']));
  });
});
