/**
 * S4-01 — PDF renderer unit tests.
 *
 * NO arrancamos Chromium real (puppeteer es lento + RAM-heavy). Mockeamos
 * `PuppeteerService.renderPdf` y verificamos:
 *   - Se invoca con HTML que incluye los datos del reporte.
 *   - Los buffers devueltos vienen del mock.
 */
import { ReportsPdfRendererService } from '../../../../src/modules/reports/reports-pdf-renderer.service';
import type { ConciliacionData } from '../../../../src/modules/reports/dto/conciliacion-report.dto';
import type { UtilizacionData } from '../../../../src/modules/reports/dto/utilizacion-report.dto';

describe('ReportsPdfRendererService', () => {
  const sampleConciliacion: ConciliacionData = {
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

  const sampleUtilizacion: UtilizacionData = {
    from: '2026-04-01',
    to: '2026-04-30',
    topN: 2,
    rows: [
      {
        packageId: 'p1',
        packageName: 'Plan Premium',
        coverageId: 'c1',
        coverageName: 'Hospital',
        coverageType: 'count_based',
        usageCount: 50,
        usageAmount: 1000,
      },
    ],
    byPackage: [{ packageId: 'p1', packageName: 'Plan Premium', totalUsageCount: 50, totalUsageAmount: 1000 }],
    generatedAt: '2026-04-27T12:00:00.000Z',
  };

  it('renderConciliacionPdf llama puppeteer.renderPdf con HTML + datos del período', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 fake');
    const renderPdf = jest.fn().mockResolvedValue({ pdf: fakePdf, durationMs: 250 });
    const svc = new ReportsPdfRendererService({ renderPdf } as never);

    const out = await svc.renderConciliacionPdf(sampleConciliacion);
    expect(out).toBe(fakePdf);
    expect(renderPdf).toHaveBeenCalledTimes(1);
    const call = renderPdf.mock.calls[0]?.[0] as { html: string; ref: string; format: string };
    expect(call.html).toContain('conciliación');
    expect(call.html).toContain('2026-04-01');
    expect(call.html).toContain('2026-04-30');
    expect(call.html).toContain('1,080'); // activosCierre formateado.
    expect(call.format).toBe('A4');
    expect(call.ref).toBe('conciliacion-2026-04-01-2026-04-30');
  });

  it('renderUtilizacionPdf llama puppeteer.renderPdf con la tabla top-N', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 fake');
    const renderPdf = jest.fn().mockResolvedValue({ pdf: fakePdf, durationMs: 110 });
    const svc = new ReportsPdfRendererService({ renderPdf } as never);

    const out = await svc.renderUtilizacionPdf(sampleUtilizacion);
    expect(out).toBe(fakePdf);
    const html = (renderPdf.mock.calls[0]?.[0] as { html: string }).html;
    expect(html).toContain('Top-2');
    expect(html).toContain('Plan Premium');
    expect(html).toContain('Hospital');
  });

  it('escapa HTML inyectado en datos (defense-in-depth)', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 fake');
    const renderPdf = jest.fn().mockResolvedValue({ pdf: fakePdf, durationMs: 50 });
    const svc = new ReportsPdfRendererService({ renderPdf } as never);

    const data: UtilizacionData = {
      ...sampleUtilizacion,
      rows: [
        {
          packageId: 'p1',
          packageName: '<script>alert(1)</script>',
          coverageId: 'c1',
          coverageName: 'Hospital "&" Clinic',
          coverageType: 'count_based',
          usageCount: 1,
          usageAmount: 1,
        },
      ],
      byPackage: [],
    };
    await svc.renderUtilizacionPdf(data);
    const html = (renderPdf.mock.calls[0]?.[0] as { html: string }).html;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Hospital &quot;&amp;&quot; Clinic');
  });
});
