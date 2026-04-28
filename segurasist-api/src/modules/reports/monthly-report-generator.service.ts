/**
 * S1 iter 2 — Implementación real del `MonthlyReportGenerator` que S3
 * (`MonthlyReportsHandlerService`) inyecta vía DI token
 * `MONTHLY_REPORT_GENERATOR` (definido en `./cron/monthly-reports-handler.service.ts`).
 *
 * El handler controla el ciclo S3 + SES + audit + DB; este generator se
 * limita a producir el Buffer del PDF para un (tenant, período). Mantenemos
 * la signature `{pdf: Buffer; summary?: {lineCount: number}}` declarada en
 * la interface — NO la modificamos para cumplir la regla "NO tocar código
 * S3" (el handler ya consume el shape original y construye su propia
 * `s3Key`/presigned URL).
 *
 * Pipeline:
 *   1. Convierte `{year, month}` a la ventana ISO `YYYY-MM-01..YYYY-MM-<lastDay>`.
 *      Usamos UTC para alinear con el resto del backend (RLS, audit, batch).
 *   2. Llama a `ReportsService.getConciliacionReport(from, to, scope)` con
 *      `scope.platformAdmin=true` + `tenantId` explícito (el handler corre
 *      con BYPASSRLS, ver ADR-0001 + JSDoc del handler).
 *   3. Renderiza el PDF con `ReportsPdfRendererService.renderConciliacionPdf`.
 *   4. Devuelve el Buffer y un `summary.lineCount` derivado del JSON
 *      (suma altas+bajas+certs como proxy del "tamaño" del reporte; el
 *      handler hoy NO usa `summary` pero la interface lo permite).
 *
 * Nota TZ: el período mensual va `[year-month-01 00:00 UTC, year-month-<last> 23:59 UTC]`.
 * `getConciliacionReport` recibe strings `YYYY-MM-DD`; el día del mes
 * resulta del cálculo `lastDayOfMonth(year, month)`. Para diciembre→31, abril→30, feb→28/29.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { MonthlyReportGenerator } from './cron/monthly-reports-handler.service';
import { ReportsPdfRendererService } from './reports-pdf-renderer.service';
import { ReportsService } from './reports.service';

@Injectable()
export class RealMonthlyReportGenerator implements MonthlyReportGenerator {
  private readonly log = new Logger(RealMonthlyReportGenerator.name);

  constructor(
    @Inject(ReportsService) private readonly reportsService: ReportsService,
    @Inject(ReportsPdfRendererService) private readonly pdfRenderer: ReportsPdfRendererService,
  ) {}

  async generate(input: {
    tenantId: string;
    period: { year: number; month: number };
  }): Promise<{ pdf: Buffer; summary?: { lineCount: number } }> {
    const { tenantId, period } = input;
    const { from, to } = monthWindow(period.year, period.month);

    // BYPASSRLS path. El handler ya documenta en JSDoc que los workers
    // corren exentos del `assertPlatformAdmin` runtime check (ADR-0001).
    // Pasamos tenantId explícito → el service filtra por ese tenant.
    const data = await this.reportsService.getConciliacionReport(from, to, {
      platformAdmin: true,
      tenantId,
      actorId: undefined,
    });

    const pdf = await this.pdfRenderer.renderConciliacionPdf(data);
    const lineCount = data.altas + data.bajas + data.certificadosEmitidos;

    this.log.log(
      { tenantId, period, from, to, bytes: pdf.length, lineCount },
      'monthly report PDF rendered',
    );

    return { pdf, summary: { lineCount } };
  }
}

/**
 * Devuelve `[YYYY-MM-01, YYYY-MM-<lastDay>]` para el mes dado (UTC).
 * Diciembre rolling-back via Date.UTC: `new Date(Date.UTC(y, 12, 0))` → 31 dic.
 */
function monthWindow(year: number, month: number): { from: string; to: string } {
  // `month` es 1..12. JavaScript Date.UTC espera month 0..11.
  // El day=0 del mes siguiente devuelve el último día del mes actual.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  const dd = String(lastDay).padStart(2, '0');
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${dd}`,
  };
}
