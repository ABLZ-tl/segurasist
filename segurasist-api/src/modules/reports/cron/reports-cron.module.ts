/**
 * S1 iter 2 — Módulo NestJS que registra el handler SQS del cron mensual
 * (`MonthlyReportsHandlerService`, owned por S3) + el provider real del
 * generator de PDF (`RealMonthlyReportGenerator`, owned por S1).
 *
 * Wiring:
 *   - Importa `ReportsModule` (ReportsService + ReportsPdfRendererService).
 *     `ReportsModule` ya importa `CertificatesModule` para reusar
 *     `PuppeteerService` singleton; no duplicamos.
 *   - `AwsModule` provee `S3Service` + `SesService` (consumidos por el
 *     handler para subir el PDF y enviar el email).
 *   - `PrismaModule` (global) provee `PrismaBypassRlsService`.
 *   - `AuditPersistenceModule` (`@Global()`) provee `AuditWriterService`.
 *   - `AppConfigModule` provee `ENV_TOKEN` (consumed por handler + S3 + SES).
 *
 * El provider del generator usa el DI token `MONTHLY_REPORT_GENERATOR`
 * declarado por el handler. Antes de iter 2 el handler arrancaba con
 * `NotImplementedMonthlyReportGenerator` (stub que lanza); ahora usa la
 * implementación real.
 *
 * En `NODE_ENV=test` o `WORKERS_ENABLED!=true`, el handler NO arranca el
 * poll loop (gate en `OnApplicationBootstrap`). Los specs invocan
 * `handleEvent()` directo con mocks.
 */
import { Module } from '@nestjs/common';
import { RealMonthlyReportGenerator } from '../monthly-report-generator.service';
import { ReportsModule } from '../reports.module';
import { MonthlyReportsHandlerService, MONTHLY_REPORT_GENERATOR } from './monthly-reports-handler.service';

@Module({
  imports: [ReportsModule],
  providers: [
    MonthlyReportsHandlerService,
    {
      provide: MONTHLY_REPORT_GENERATOR,
      useClass: RealMonthlyReportGenerator,
    },
    RealMonthlyReportGenerator,
  ],
  exports: [MonthlyReportsHandlerService],
})
export class ReportsCronModule {}
