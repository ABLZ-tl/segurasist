import { CertificatesModule } from '@modules/certificates/certificates.module';
import { Module } from '@nestjs/common';
import { ReportsPdfRendererService } from './reports-pdf-renderer.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsXlsxRendererService } from './reports-xlsx-renderer.service';

/**
 * S2-05 (dashboard) + S4-01/02/03 (conciliación + volumetría + utilización).
 *
 * `CertificatesModule` se importa para reusar `PuppeteerService` (singleton
 * Chromium) — evita doble launch del browser cuando ambos módulos generan
 * PDFs. Ver patrón equivalente en `reports-worker.service.ts`.
 *
 * `AuditWriterService` y `AuditContextFactory` los inyectamos directo desde
 * `AuditPersistenceModule` (`@Global()` — sin import explícito).
 */
@Module({
  imports: [CertificatesModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsPdfRendererService, ReportsXlsxRendererService],
  exports: [ReportsService, ReportsPdfRendererService],
})
export class ReportsModule {}
