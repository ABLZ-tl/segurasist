import { Module } from '@nestjs/common';
import { EmailWorkerService } from '../../workers/email-worker.service';
import { MailpitTrackerService } from '../../workers/mailpit-tracker.service';
import { PdfWorkerService } from '../../workers/pdf-worker.service';
import { ReportsWorkerService } from '../../workers/reports-worker.service';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { PuppeteerService } from './puppeteer.service';

/**
 * Wireup S2-03 / S2-04 / S3-09. Los workers se registran como providers del
 * módulo para que `OnApplicationBootstrap` arranque el polling al boot del API.
 *
 * NOTA: en NODE_ENV=test los workers detectan el env y NO arrancan el loop;
 * los specs invocan `pollOnce()` / `handleEvent()` directos.
 *
 * `ReportsWorkerService` (S3-09) reusa `PuppeteerService` para renderizar
 * PDFs de exports — por eso vive en este módulo y no en `WorkersModule`,
 * que requiere registrar la dependencia en el container.
 */
@Module({
  controllers: [CertificatesController],
  providers: [
    CertificatesService,
    PuppeteerService,
    PdfWorkerService,
    EmailWorkerService,
    MailpitTrackerService,
    ReportsWorkerService,
  ],
  exports: [CertificatesService, PuppeteerService, ReportsWorkerService],
})
export class CertificatesModule {}
